import { useInfiniteScroll } from 'ahooks';
import { Button, Tooltip } from 'antd';
import { TokenItem, TxHistoryResult } from 'background/service/openapi';
import clsx from 'clsx';
import { last } from 'lodash';
import React, { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useHistory } from 'react-router-dom';
import IconExternal from 'ui/assets/icon-share.svg';
import { Copy, Modal, TokenWithChain } from 'ui/component';
import {
  splitNumberByStep,
  useWallet,
  openInTab,
  useCommonPopupView,
} from 'ui/utils';
import { getChain } from '@/utils';
import ChainIcon from '../NFT/ChainIcon';
import { HistoryItem } from './HistoryItem';
import { Loading } from './Loading';
import './style.less';
import { CHAINS } from 'consts';
import { ellipsisOverflowedText } from 'ui/utils';
import { getTokenSymbol } from '@/ui/utils/token';
import { SWAP_SUPPORT_CHAINS } from '@/constant';
import { CustomizedButton } from './CustomizedButton';
import { BlockedButton } from './BlockedButton';
import { useRabbySelector } from '@/ui/store';

const PAGE_COUNT = 10;
const ellipsis = (text: string) => {
  return text.replace(/^(.{6})(.*)(.{4})$/, '$1...$3');
};

interface TokenDetailProps {
  onClose?(): void;
  token: TokenItem;
  addToken(token: TokenItem): void;
  removeToken(token: TokenItem): void;
  variant?: 'add';
  isAdded?: boolean;
}

const TokenDetail = ({
  token,
  addToken,
  removeToken,
  variant,
  isAdded,
}: TokenDetailProps) => {
  const wallet = useWallet();
  const { t } = useTranslation();
  const { currentAccount } = useRabbySelector((s) => s.account);
  const [tokenWithAmount, setTokenWithAmount] = React.useState<TokenItem>(
    token
  );
  const shouldSelectDex = false;

  const tokenSupportSwap = useMemo(() => {
    if (shouldSelectDex || !token.is_core) return false;
    const tokenChain = getChain(token?.chain)?.enum;
    return !!tokenChain && SWAP_SUPPORT_CHAINS.includes(tokenChain as any);
  }, [token, shouldSelectDex]);

  const ref = useRef<HTMLDivElement | null>(null);

  const getTokenAmount = React.useCallback(async () => {
    if (token.amount !== undefined) return;
    const info = await wallet.openapi.getToken(
      currentAccount!.address,
      token.chain,
      token.id
    );
    if (info) {
      setTokenWithAmount({
        ...token,
        amount: info.amount,
      });
    }
  }, [token]);

  React.useEffect(() => {
    if (currentAccount) {
      getTokenAmount();
    }
  }, [currentAccount, getTokenAmount]);

  const fetchData = async (startTime = 0) => {
    const res: TxHistoryResult = await wallet.openapi.listTxHisotry({
      id: currentAccount!.address,
      chain_id: token.chain,
      start_time: startTime,
      page_count: PAGE_COUNT,
      token_id: token.id,
    });
    const { project_dict, cate_dict, token_dict, history_list: list } = res;
    const displayList = list
      .map((item) => ({
        ...item,
        projectDict: project_dict,
        cateDict: cate_dict,
        tokenDict: token_dict,
      }))
      .sort((v1, v2) => v2.time_at - v1.time_at);
    return {
      last: last(displayList)?.time_at,
      list: displayList,
    };
  };

  const { data, loading, loadingMore } = useInfiniteScroll(
    (d) => fetchData(d?.last),
    {
      target: ref,
      isNoMore: (d) => {
        return !d?.last || (d?.list.length || 0) < PAGE_COUNT;
      },
    }
  );

  const handleClickLink = (token: TokenItem) => {
    const serverId = token.chain;
    const chain = Object.values(CHAINS).find(
      (item) => item.serverId === serverId
    );
    if (!chain) return;
    const prefix = chain.scanLink?.replace('/tx/_s_', '');
    openInTab(`${prefix}/token/${token.id}`);
  };

  const handleRemove = async (token: TokenItem) => {
    const { destroy } = Modal.info({
      closable: true,
      className: 'token-detail-remove-modal',
      width: 320,
      content: (
        <div>
          <div className="mb-[16px]">
            This will only stop the token from being visible in Rabby and will
            not affect its balance
          </div>
          <Button
            type="primary"
            size="large"
            className="w-[170px]"
            onClick={async () => {
              await removeToken(token);
              destroy();
            }}
          >
            Remove
          </Button>
        </div>
      ),
    });
  };

  const isEmpty = (data?.list?.length || 0) <= 0 && !loading;

  const isShowAddress = /^0x.{40}$/.test(token.id);
  const { closePopup } = useCommonPopupView();

  const history = useHistory();
  const goToSend = useCallback(() => {
    history.push(
      `/send-token?rbisource=tokendetail&token=${token?.chain}:${token?.id}`
    );
    closePopup();
  }, [history, token]);

  const goToReceive = useCallback(() => {
    history.push(
      `/receive?rbisource=tokendetail&chain=${
        getChain(token?.chain)?.enum
      }&token=${token?.symbol}`
    );
    closePopup();
  }, [history, token]);

  const goToSwap = useCallback(() => {
    history.push(
      `/dex-swap?rbisource=tokendetail&chain=${token?.chain}&payTokenId=${token?.id}`
    );
    closePopup();
  }, [history, token]);

  const isHiddenButton =
    // Customized and not added
    variant === 'add' && !token.is_core && !isAdded;

  return (
    <div className="token-detail" ref={ref}>
      <div className={clsx('token-detail-header', 'border-b-0 pb-24')}>
        <div className={clsx('flex items-center', 'mb-20')}>
          <div className="flex items-center mr-8">
            <TokenWithChain
              token={token}
              hideConer
              width="24px"
              height="24px"
            ></TokenWithChain>
            <div className="token-symbol ml-8" title={getTokenSymbol(token)}>
              {ellipsisOverflowedText(getTokenSymbol(token), 8)}
            </div>
          </div>
          <div className="address">
            <ChainIcon chain={token.chain}></ChainIcon>
            {isShowAddress ? (
              <>
                {ellipsis(token.id)}
                <img
                  src={IconExternal}
                  className="w-14 cursor-pointer"
                  alt=""
                  onClick={() => {
                    handleClickLink(token);
                  }}
                />
                <Copy
                  data={token.id}
                  variant="address"
                  className="w-14 cursor-pointer"
                />
              </>
            ) : (
              token?.name
            )}
          </div>
        </div>
        {variant === 'add' ? (
          token.is_core ? (
            <BlockedButton
              selected={isAdded}
              onOpen={() => addToken(tokenWithAmount)}
              onClose={() => removeToken(tokenWithAmount)}
            />
          ) : (
            <CustomizedButton
              selected={isAdded}
              onOpen={() => addToken(tokenWithAmount)}
              onClose={() => removeToken(tokenWithAmount)}
            />
          )
        ) : null}
        <div className="balance">
          <div className="balance-title">{getTokenSymbol(token)} balance</div>
          <div className="balance-content overflow-hidden">
            <div
              className="balance-value truncate"
              title={splitNumberByStep(
                (tokenWithAmount.amount || 0)?.toFixed(4)
              )}
            >
              {splitNumberByStep((tokenWithAmount.amount || 0)?.toFixed(4))}
            </div>
            <div
              className="balance-value-usd truncate"
              title={splitNumberByStep(
                (tokenWithAmount.amount * token.price || 0)?.toFixed(2)
              )}
            >
              ≈ $
              {splitNumberByStep(
                (tokenWithAmount.amount * token.price || 0)?.toFixed(2)
              )}
            </div>
          </div>
        </div>

        {!isHiddenButton && (
          <div className="flex flex-row justify-between mt-24">
            <Tooltip
              overlayClassName="rectangle token_swap__tooltip"
              placement="topLeft"
              title={
                shouldSelectDex
                  ? 'Please select the dex in swap first'
                  : t('The token on this chain is not supported')
              }
              visible={tokenSupportSwap ? false : undefined}
            >
              <Button
                type="primary"
                size="large"
                onClick={goToSwap}
                disabled={!tokenSupportSwap}
                style={{
                  width: 114,
                }}
              >
                Swap
              </Button>
            </Tooltip>

            <Button
              type="primary"
              ghost
              size="large"
              className="w-[114px] rabby-btn-ghost"
              onClick={goToSend}
            >
              {t('Send')}
            </Button>
            <Button
              type="primary"
              ghost
              size="large"
              className="w-[114px] rabby-btn-ghost"
              onClick={goToReceive}
            >
              {t('Receive')}
            </Button>
          </div>
        )}
      </div>

      <div className={clsx('token-detail-body token-txs-history', 'pt-[0px]')}>
        {data?.list.map((item) => (
          <HistoryItem
            data={item}
            projectDict={item.projectDict}
            cateDict={item.cateDict}
            tokenDict={item.tokenDict}
            key={item.id}
          ></HistoryItem>
        ))}
        {(loadingMore || loading) && <Loading count={5} active />}
        {isEmpty && (
          <div className="token-txs-history__empty">
            <img className="no-data" src="./images/nodata-tx.png" />
            <p className="text-14 text-gray-content mt-12">
              {t('No Transactions')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TokenDetail;
