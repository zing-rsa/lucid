import { C } from '../core/index';
import Core from 'core/types';
import { costModel, fromHex, utxoToCore, coreToUtxo } from '../utils';
import {
  Address,
  ExternalWallet,
  Network,
  PrivateKey,
  Provider,
  Slot,
  TxHash,
  Unit,
  UTxO,
  Wallet,
  WalletProvider,
} from '../types/index.js';

export class Lucid {
  static txBuilderConfig: Core.TransactionBuilderConfig;
  static wallet: Wallet;
  static provider: Provider;
  static network: Network;

  static async initialize(network: Network, provider: Provider) {
    this.provider = provider;
    this.network = network;
    const protocolParameters = await provider.getProtocolParameters();
    this.txBuilderConfig = C.TransactionBuilderConfigBuilder.new()
      .coins_per_utxo_word(
        C.BigNum.from_str(protocolParameters.coinsPerUtxoWord.toString())
      )
      .fee_algo(
        C.LinearFee.new(
          C.BigNum.from_str(protocolParameters.minFeeA.toString()),
          C.BigNum.from_str(protocolParameters.minFeeB.toString())
        )
      )
      .key_deposit(C.BigNum.from_str(protocolParameters.keyDeposit.toString()))
      .pool_deposit(
        C.BigNum.from_str(protocolParameters.poolDeposit.toString())
      )
      .max_tx_size(protocolParameters.maxTxSize)
      .max_value_size(protocolParameters.maxValSize)
      .ex_unit_prices(
        C.ExUnitPrices.from_float(
          protocolParameters.priceMem,
          protocolParameters.priceStep
        )
      )
      .blockfrost(
        C.Blockfrost.new(
          provider.url + '/utils/txs/evaluate',
          provider.projectId
        )
      )
      .costmdls(costModel.plutusV1())
      .prefer_pure_change(true)
      .build();
  }

  static async currentSlot(): Promise<Slot> {
    return this.provider.getCurrentSlot();
  }

  static async utxosAt(address: Address): Promise<UTxO[]> {
    return this.provider.getUtxos(address);
  }

  static async utxosAtWithUnit(address: Address, unit: Unit): Promise<UTxO[]> {
    return this.provider.getUtxosWithUnit(address, unit);
  }

  static async awaitTx(txHash: TxHash): Promise<boolean> {
    return this.provider.awaitTx(txHash);
  }

  /**
   * Cardano Private key in bech32; not the BIP32 private key or any key that is not fully derived
   */
  static async selectWalletFromPrivateKey(privateKey: PrivateKey) {
    const priv = C.PrivateKey.from_bech32(privateKey);
    const pubKeyHash = priv.to_public().hash();
    const address = C.EnterpriseAddress.new(
      this.network === 'Mainnet' ? 1 : 0,
      C.StakeCredential.from_keyhash(pubKeyHash)
    )
      .to_address()
      .to_bech32();
    this.wallet = {
      address,
      getCollateral: async () => {
        const utxos = await Lucid.utxosAt(address);
        return utxos.filter(
          utxo =>
            Object.keys(utxo.assets).length === 1 &&
            utxo.assets.lovelace >= 5000000n
        );
      },
      getCollateralCore: async () => {
        const utxos = await Lucid.utxosAt(address);
        return utxos
          .filter(
            utxo =>
              Object.keys(utxo.assets).length === 1 &&
              utxo.assets.lovelace >= 5000000n
          )
          .map(utxo => utxoToCore(utxo));
      },
      getUtxos: async () => {
        return await Lucid.utxosAt(address);
      },
      getUtxosCore: async () => {
        const utxos = await Lucid.utxosAt(address);
        const coreUtxos = C.TransactionUnspentOutputs.new();
        utxos.forEach(utxo => {
          coreUtxos.add(utxoToCore(utxo));
        });
        return coreUtxos;
      },
      signTx: async (tx: Core.Transaction) => {
        const witness = C.make_vkey_witness(
          C.hash_transaction(tx.body()),
          priv
        );
        const txWitnessSetBuilder = C.TransactionWitnessSetBuilder.new();
        txWitnessSetBuilder.add_vkey(witness);
        return txWitnessSetBuilder.build();
      },
      submitTx: async (tx: Core.Transaction) => {
        return await Lucid.provider.submitTx(tx);
      },
    };
  }

  static async selectWallet(walletProvider: WalletProvider) {
    if (!window?.cardano?.[walletProvider]) {
      throw new Error('Wallet not installed or not in a browser environment');
    }
    const api = await window.cardano[walletProvider].enable();

    const address = C.Address.from_bytes(
      Buffer.from((await api.getUsedAddresses())[0], 'hex')
    ).to_bech32();

    const rewardAddressHex = (await api.getRewardAddresses())[0];
    const rewardAddress =
      rewardAddressHex ??
      C.RewardAddress.from_address(
        C.Address.from_bytes(Buffer.from(rewardAddressHex, 'hex'))
      )!
        .to_address()
        .to_bech32();

    this.wallet = {
      address,
      rewardAddress,
      getCollateral: async () => {
        const utxos = (await api.experimental.getCollateral()).map(utxo => {
          const parsedUtxo = C.TransactionUnspentOutput.from_bytes(
            Buffer.from(utxo, 'hex')
          );
          return coreToUtxo(parsedUtxo);
        });
        return utxos;
      },
      getCollateralCore: async () => {
        const utxos = (await api.experimental.getCollateral()).map(utxo => {
          return C.TransactionUnspentOutput.from_bytes(
            Buffer.from(utxo, 'hex')
          );
        });
        return utxos;
      },
      getUtxos: async () => {
        const utxos = ((await api.getUtxos()) || []).map(utxo => {
          const parsedUtxo = C.TransactionUnspentOutput.from_bytes(
            Buffer.from(utxo, 'hex')
          );
          return coreToUtxo(parsedUtxo);
        });
        return utxos;
      },
      getUtxosCore: async () => {
        const utxos = C.TransactionUnspentOutputs.new();
        ((await api.getUtxos()) || []).forEach(utxo => {
          utxos.add(
            C.TransactionUnspentOutput.from_bytes(Buffer.from(utxo, 'hex'))
          );
        });
        return utxos;
      },
      signTx: async (tx: Core.Transaction) => {
        const witnessSet = await api.signTx(
          Buffer.from(tx.to_bytes()).toString('hex'),
          true
        );
        return C.TransactionWitnessSet.from_bytes(
          Buffer.from(witnessSet, 'hex')
        );
      },
      submitTx: async (tx: Core.Transaction) => {
        const txHash = await api.submitTx(
          Buffer.from(tx.to_bytes()).toString('hex')
        );
        return txHash;
      },
    };
  }

  /**
   * Emulates a CIP30 wallet by constructing it
   * with the UTxOs, collateral and addresses.
   */
  static async selectWalletFromUtxos({
    address,
    utxos: rawUtxos,
    collateral,
    rewardAddress,
  }: ExternalWallet) {
    this.wallet = {
      address,
      rewardAddress,
      getCollateral: async () => {
        return collateral
          ? collateral.map(rawUtxo =>
              coreToUtxo(
                C.TransactionUnspentOutput.from_bytes(fromHex(rawUtxo))
              )
            )
          : [];
      },
      getCollateralCore: async () => {
        return collateral
          ? collateral.map(rawUtxo =>
              C.TransactionUnspentOutput.from_bytes(fromHex(rawUtxo))
            )
          : [];
      },
      getUtxos: async () => {
        const utxos = rawUtxos.map(utxo => {
          const parsedUtxo = C.TransactionUnspentOutput.from_bytes(
            fromHex(utxo)
          );
          return coreToUtxo(parsedUtxo);
        });
        return utxos;
      },
      getUtxosCore: async () => {
        const coreUtxos = C.TransactionUnspentOutputs.new();
        rawUtxos.forEach(rawUtxo =>
          coreUtxos.add(C.TransactionUnspentOutput.from_bytes(fromHex(rawUtxo)))
        );
        return coreUtxos;
      },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      signTx: async (_: Core.Transaction) => {
        throw new Error('Not implemented');
      },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      submitTx: async (_: Core.Transaction) => {
        throw new Error('Not implemented');
      },
    };
  }
}

if (typeof window === 'undefined') {
  const fetch = await import(/* webpackIgnore: true */ 'node-fetch');
  // @ts-ignore
  global.fetch = fetch.default;
  // @ts-ignore
  global.Headers = fetch.Headers;
  // @ts-ignore
  global.Request = fetch.Request;
  // @ts-ignore
  global.Response = fetch.Response;
}