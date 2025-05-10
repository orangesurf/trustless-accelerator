# pleb priority
locally apply out of band fee deltas to your bitcoin core node (using acceleration data from the mempool.space API)

## Inband vs Out-of-band Bids
Inband block bids are well accommodated by Bitcoin Core, provided your policy rules ensure incentive compatible.
Out-of-band bids are outside the remit of Bitcoin Core for good reason.

## What are Out-of-band bids?
Out-of-band bids are incentives made to miners/pools to prioritise transactions, beyond the inband fee. They can be made:
- to individual miners/pools who offer acceleration services
- via acceleration market places (e.g. Mempool Accelerator, which places acceleration requests to 80% of the network hashrate)  

## Current Problems
- Mining Centralisation: Mempool Accelerator doesn't currently have a way for smaller pleb miners to access the additional out-of-band revenue.
- Inaccurate Fee Projection: Nodes which are unaware of out-of-band accelerations may underestimate projected fees 

## Proposed Solution
1. Fetch API accelerations from mempool.space (no API key required)
2. Store accelerations in a local .json file
3. Prioritize transactions in local Bitcoin Core

## Benefits to node runners
- Non Mining Nodes: Have a local mempool that is mempool accelerator aware
- Mining Nodes: Theoretically in the future mempool.space could opt to pay pleb miners for accelerated transactions (e.g. to the blocks coinbase address) 


## Notes
eventType
- legacy: old accelerations which are pending 
- added: fresh in off the websocket
- removed: no longer being accelerated 

Command to get position of txid in local block template

```
txid="YOUR_TRANSACTION_ID_HERE"
bitcoin-cli getblocktemplate '{"rules": ["segwit"]}' | jq --arg txid "$txid" '.transactions | map(.txid == $txid) | index(true)'
```
