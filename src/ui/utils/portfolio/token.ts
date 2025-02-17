import { useRef, useEffect } from 'react';
import produce from 'immer';
import { Dayjs } from 'dayjs';
import { TokenItem } from '@rabby-wallet/rabby-api/dist/types';
import { CHAINS } from '@debank/common';
import { useRabbyDispatch, useRabbySelector } from 'ui/store';
import { findChainByEnum } from '@/utils/chain';
import { useWallet } from '../WalletContext';
import { useSafeState } from '../safeState';
import { log } from './usePortfolio';
import {
  PortfolioItem,
  PortfolioItemToken,
} from '@rabby-wallet/rabby-api/dist/types';
import { DisplayedProject, DisplayedToken } from './project';
import { AbstractPortfolioToken } from './types';
import { getMissedTokenPrice } from './utils';
import {
  walletProject,
  batchQueryTokens,
  batchQueryHistoryTokens,
  setWalletTokens,
  queryTokensCache,
  sortWalletTokens,
} from './tokenUtils';
import { isSameAddress } from '..';
import { Token } from 'background/service/preference';

// export const tokenChangeLoadingAtom = atom(false);

const filterDisplayToken = (
  tokens: AbstractPortfolioToken[],
  blocked: Token[]
) => {
  const ChainValues = Object.values(CHAINS);
  return tokens.filter((token) => {
    const chain = ChainValues.find((chain) => chain.serverId === token.chain);
    return (
      token.is_core &&
      !blocked.find(
        (item) =>
          isSameAddress(token._tokenId, item.address) &&
          item.chain === token.chain
      ) &&
      findChainByEnum(chain?.enum)
    );
  });
};

export const useTokens = (
  userAddr: string | undefined,
  timeAt?: Dayjs,
  visible = true,
  updateNonce = 0,
  chainId?: string
) => {
  const abortProcess = useRef<AbortController>();
  const [data, setData] = useSafeState(walletProject);
  const [isLoading, setLoading] = useSafeState(true);
  const historyTime = useRef<number>();
  const historyLoad = useRef<boolean>(false);
  const wallet = useWallet();
  const dispatch = useRabbyDispatch();
  const { customize, list, blocked } = useRabbySelector(
    (store) => store.account.tokens
  );
  const userAddrRef = useRef('');
  const chainIdRef = useRef<string | undefined>(undefined);
  // const setTokenChangeLoading = useSetAtom(tokenChangeLoadingAtom);

  useEffect(() => {
    if (updateNonce === 0) return;
    loadProcess();
  }, [updateNonce]);

  useEffect(() => {
    if (userAddr) {
      if (
        visible &&
        (!isSameAddress(userAddr, userAddrRef.current) ||
          chainId !== chainIdRef.current)
      ) {
        loadProcess().then(() => {
          userAddrRef.current = userAddr;
          chainIdRef.current = chainId;
        });
      }
    } else {
      setData(undefined);
    }
  }, [userAddr, visible, chainId]);

  useEffect(() => {
    if (timeAt) {
      historyTime.current = timeAt.unix();

      if (!isLoading) {
        loadHistory();
      }
    } else {
      historyTime.current = 0;
    }
    // eslint-disable-next-line
  }, [timeAt, isLoading]);

  const loadProcess = async () => {
    if (!userAddr) {
      return;
    }

    const currentAbort = new AbortController();
    abortProcess.current = currentAbort;
    historyLoad.current = false;

    setLoading(true);
    log('======Start-Tokens======', userAddr);
    let _data = produce(walletProject, (draft) => {
      draft.netWorth = 0;
      draft._netWorth = '$0';
      draft._netWorthChange = '-';
      draft.netWorthChange = 0;
      draft._netWorthChangePercent = '';
    });

    let _tokens: AbstractPortfolioToken[] = [];
    setData(_data);

    const snapshot = await queryTokensCache(userAddr, wallet);
    const blocked = await wallet.getBlockedToken();
    if (snapshot?.length) {
      const chainTokens = snapshot.reduce((m, n) => {
        m[n.chain] = m[n.chain] || [];
        m[n.chain].push(n);

        return m;
      }, {} as Record<string, TokenItem[]>);
      _data = produce(_data, (draft) => {
        setWalletTokens(draft, chainTokens);
      });

      setData(_data);
      _tokens = sortWalletTokens(_data);
      dispatch.account.setTokenList(filterDisplayToken(_tokens, blocked));
      setLoading(false);
      // setTokens(filterDisplayToken(_tokens, blocked));
    }

    const tokenRes = await batchQueryTokens(userAddr, wallet, chainId);
    // customize and blocked tokens
    const customizeTokens = await wallet.getCustomizedToken();
    const customTokenList: TokenItem[] = [];
    const blockedTokenList: TokenItem[] = [];
    tokenRes.forEach((token) => {
      if (
        customizeTokens.find(
          (t) => isSameAddress(token.id, t.address) && token.chain === t.chain
        )
      ) {
        // customize with balance
        customTokenList.push(token);
      }
      if (
        blocked.find(
          (t) => isSameAddress(token.id, t.address) && token.chain === t.chain
        )
      ) {
        blockedTokenList.push(token);
      }
    });
    const noBalanceBlockedTokens = blocked.filter((token) => {
      return !blockedTokenList.find(
        (t) => isSameAddress(token.address, t.id) && token.chain === t.chain
      );
    });
    const noBalanceCustomizeTokens = customizeTokens.filter((token) => {
      return !customTokenList.find(
        (t) => isSameAddress(token.address, t.id) && token.chain === t.chain
      );
    });
    if (noBalanceCustomizeTokens.length > 0) {
      const noBalanceCustomTokens = await wallet.openapi.customListToken(
        noBalanceCustomizeTokens.map((item) => `${item.chain}:${item.address}`),
        userAddr
      );
      customTokenList.push(
        ...noBalanceCustomTokens.filter((token) => !token.is_core)
      );
    }
    if (noBalanceBlockedTokens.length > 0) {
      const blockedTokens = await wallet.openapi.customListToken(
        noBalanceBlockedTokens.map((item) => `${item.chain}:${item.address}`),
        userAddr
      );
      blockedTokenList.push(...blockedTokens.filter((token) => token.is_core));
    }
    const formattedCustomTokenList = customTokenList.map(
      (token) => new DisplayedToken(token) as AbstractPortfolioToken
    );
    const formattedBlockedTokenList = blockedTokenList.map(
      (token) => new DisplayedToken(token) as AbstractPortfolioToken
    );
    dispatch.account.setBlockedTokenList(formattedBlockedTokenList);
    dispatch.account.setCustomizeTokenList(formattedCustomTokenList);

    const tokensDict: Record<string, TokenItem[]> = {};
    tokenRes.forEach((token) => {
      if (!tokensDict[token.chain]) {
        tokensDict[token.chain] = [];
      }
      tokensDict[token.chain].push(token);
    });

    _data = produce(_data, (draft) => {
      setWalletTokens(draft, tokensDict);
    });

    setData(_data);
    _tokens = sortWalletTokens(_data);
    dispatch.account.setTokenList([
      ...filterDisplayToken(_tokens, blocked),
      ...formattedCustomTokenList,
    ]);
    setLoading(false);

    loadHistory(_data, currentAbort);

    log('<<==Tokens-end==>>', userAddr);
  };

  const loadHistory = async (
    pre?: DisplayedProject,
    currentAbort = new AbortController()
  ) => {
    if (!historyTime.current || !userAddr || historyLoad.current) {
      log('middle-tokens-end');
      return;
    }

    abortProcess.current = currentAbort;
    historyLoad.current = true;

    let _data = pre || data!;

    log('===token===batchhistory====', userAddr);
    // setTokenChangeLoading(true);

    if (currentAbort.signal.aborted || !_data?.netWorth) {
      setLoading(false);
      return;
    }

    const historyTokenRes = await batchQueryHistoryTokens(
      userAddr,
      historyTime.current,
      wallet
    );

    if (currentAbort.signal.aborted) {
      setLoading(false);
      return;
    }

    const historyPortfolios: PortfolioItem[] = [];

    historyTokenRes?.forEach((token) => {
      const chain = token.chain;
      const index = historyPortfolios.findIndex((p) => p.pool.id === chain);
      if (index === -1) {
        historyPortfolios.push({
          pool: {
            id: chain,
          },
          asset_token_list: [token as PortfolioItemToken],
        } as PortfolioItem);
      } else {
        historyPortfolios[index].asset_token_list?.push(
          token as PortfolioItemToken
        );
      }
    });

    _data = produce(_data, (draft) => {
      draft.patchHistory(historyPortfolios);
    });

    const tokenList = sortWalletTokens(_data);
    dispatch.account.setTokenList(tokenList);
    setData(_data);

    if (currentAbort.signal.aborted) {
      setLoading(false);
      return;
    }

    const missedTokens = tokenList.reduce((m, n) => {
      if (n._tokenId && !n._historyPatched) {
        m[n.chain] = m[n.chain] || new Set();
        m[n.chain].add(n._tokenId);
      }

      return m;
    }, {} as Record<string, Set<string>>);

    const priceDicts = await getMissedTokenPrice(
      missedTokens,
      historyTime.current,
      wallet
    );

    if (currentAbort.signal.aborted || !priceDicts) {
      setLoading(false);
      return;
    }

    _data = produce(_data, (draft) => {
      Object.entries(priceDicts).forEach(([c, dict]) => {
        if (!draft._portfolioDict[c]._historyPatched) {
          draft._portfolioDict[c].patchPrice(dict);
          if (draft._portfolioDict[c].netWorthChange) {
            draft.netWorthChange += draft._portfolioDict[c].netWorthChange;
          }
        }
        draft.afterHistoryPatched();
      });
    }) as DisplayedProject;

    if (currentAbort.signal.aborted) {
      setLoading(false);
      return;
    }

    setData(_data);
    dispatch.account.setTokenList(sortWalletTokens(_data));
  };

  useEffect(() => {
    return () => {
      abortProcess.current?.abort();
    };
  }, []);

  return {
    netWorth: data?.netWorth || 0,
    isLoading,
    tokens: list,
    customizeTokens: customize,
    blockedTokens: blocked,
    hasValue: !!data?._portfolios?.length,
    updateData: loadProcess,
    walletProject: data,
  };
};
