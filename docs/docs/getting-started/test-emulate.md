---
title: Test and emulate
description: Test and emulate transactions with the builtin emulator. 
order: 8
---

## Initialize emulator

The emulator serves as a unique provider in Lucid, and it can be instantiated in
the same way as any other provider. This provides a seamless experience,
allowing for easy substitution of the emulator with a real network provider.

```js
const emulator = new Emulator([{
  address: "addr_test...",
  assets: { lovelace: 3000000000n },
}]);

const lucid = new Lucid({ provider: emulator });
```

## Working with time ranges

Unfortunately `Date.now()` doesn't work with the emulator because the network is
not live and steps are only taken when requested. Instead you have to use
`emulator.now()`;

```js
const tx = await lucid.newTx()
  .validTo(emulator.now())
  .commit();
```

## Distribute staking rewards

The emulator allows you to conveniently distribute rewards to all delegated
stake addresses.

```js
emulator.distributeRewards(100000000n);
```