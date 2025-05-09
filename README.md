# trustless-accelerator
locally apply mempool accelerations 

Motivation
- Non Mining Node: Have a local mempool that is mempool accelerator aware
- Mining Node: Theoretically mempool.space could choose to pay you (e.g. to your coinbase address) for making these accelerations 

1. Get acccelerations (txid and fee_delta) from mempool.space websocket
2. Log to a file
3. Read file and apply each acceleration to bitcoin core with the prioritisetransaction rpc

* the fee_delta is not necessarily what is paid to miner, details are out of scope for this hackathon

Applying an acceleration locally 
```
bitcoin-cli -rpcwallet=cormorant prioritisetransaction "<txid>" 0.0 <fee_delta>
bitcoin-cli -rpcwallet=cormorant prioritisetransaction "a29ad50fc90d15c9287a23648e63cc4497927372d838d0b963e10102376c6e68" 0.0 100000
```

eventType
- legacy: old accelerations which are pending 
- added: fresh in off the websocket
- removed: no longer being accelerated 
