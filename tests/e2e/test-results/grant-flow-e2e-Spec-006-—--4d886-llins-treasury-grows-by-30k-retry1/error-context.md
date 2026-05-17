# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: grant-flow-e2e.spec.ts >> Spec 006 — grant flow E2E (validator + steward UI) >> Sarah attests both milestones, Maria releases both, Fort Collins treasury grows by $30k
- Location: grant-flow-e2e.spec.ts:125:7

# Error details

```
Test timeout of 300000ms exceeded.
```

```
Error: locator.click: Test timeout of 300000ms exceeded.
Call log:
  - waiting for locator('[data-commitment-subject="0x1eb7a3082bdb840f702057719b002be9eb8d1183347d8a9d6b29f9b39eb0b425"][data-task-kind="attestation"]').first().getByRole('button', { name: /Attest delivered/i })

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - button "Open Next.js Dev Tools" [ref=e7] [cursor=pointer]:
    - img [ref=e8]
  - alert [ref=e11]
  - generic [ref=e12]:
    - banner [ref=e13]:
      - generic [ref=e14]:
        - link "Trust Workspace home" [ref=e15] [cursor=pointer]:
          - /url: /
          - img [ref=e16]
          - generic [ref=e23]: Trust Workspace
        - navigation "Primary navigation" [ref=e25]:
          - link "Home" [ref=e26] [cursor=pointer]:
            - /url: /dashboard
          - link "Organizations" [ref=e27] [cursor=pointer]:
            - /url: /groups
          - link "Govern" [ref=e28] [cursor=pointer]:
            - /url: /steward
          - link "Activity" [ref=e29] [cursor=pointer]:
            - /url: /activity
        - generic [ref=e30]:
          - button "Open navigation" [ref=e31] [cursor=pointer]: ☰
          - button "Toggle agent assistant" [ref=e32] [cursor=pointer]: 🤖
          - button "User menu for sarah-thompson.agent" [ref=e34] [cursor=pointer]:
            - generic [ref=e35]: S
            - generic [ref=e36]:
              - generic [ref=e37]: sarah-thompson.agent
              - generic [ref=e38]: Sarah Thompson
            - generic [ref=e39]: ▼
      - navigation "Breadcrumb" [ref=e40]:
        - list [ref=e41]:
          - listitem [ref=e42]:
            - link "Home" [ref=e43] [cursor=pointer]:
              - /url: /h/catalyst/home
          - listitem [ref=e44]:
            - generic [ref=e45]: ">"
            - generic [ref=e46]: Tasks
    - generic [ref=e47]:
      - main [ref=e48]:
        - generic [ref=e49]:
          - generic [ref=e50]: Working as
          - strong [ref=e51]: Sarah Thompson
          - code [ref=e52]: sarah-thompson.agent
          - generic [ref=e53]: ·
          - generic [ref=e54]:
            - text: "Mode:"
            - strong [ref=e55]: Walk
            - generic [ref=e56]: · also Discover
        - generic [ref=e57]:
          - generic [ref=e58]:
            - generic [ref=e59]: Catalyst NoCo Network · Your tasks
            - heading "Funding milestones (20)" [level=1] [ref=e60]
            - paragraph [ref=e61]: Milestones across every active commitment that need an action from you — attestations to record, tranches to release.
          - generic [ref=e62]:
            - heading "●Awaiting your attestation (20)" [level=2] [ref=e63]
            - generic [ref=e64]:
              - generic [ref=e65]:
                - generic [ref=e66]: Kickoff + first cohort
                - generic [ref=e67]: $12.0k
              - generic [ref=e68]:
                - text: Donor
                - strong [ref=e69]: "Demo Grant Flow Pool #57"
                - text: → Recipient
                - strong [ref=e70]: Fort Collins Network Treasury
                - text: · need
                - link "demo-david-trauma-care-057" [ref=e71] [cursor=pointer]:
                  - /url: /h/catalyst/intents/demo-david-trauma-care-057
              - generic [ref=e72]:
                - generic [ref=e73]:
                  - textbox "Evidence summary" [active] [ref=e74]:
                    - /placeholder: Evidence summary (optional)
                    - text: E2E run — milestone 1 attested by Sarah
                  - button "Confirm milestone" [ref=e75] [cursor=pointer]
                - link "View proposal + commitment" [ref=e77] [cursor=pointer]:
                  - /url: /h/catalyst/proposals/0x50c11457054bf790270a64db6716192ae45f5c15d690968f4a7d7933bbb490ce
            - generic [ref=e78]:
              - generic [ref=e79]:
                - generic [ref=e80]: Final report + outcomes
                - generic [ref=e81]: $18.0k
              - generic [ref=e82]:
                - text: Donor
                - strong [ref=e83]: "Demo Grant Flow Pool #57"
                - text: → Recipient
                - strong [ref=e84]: Fort Collins Network Treasury
                - text: · need
                - link "demo-david-trauma-care-057" [ref=e85] [cursor=pointer]:
                  - /url: /h/catalyst/intents/demo-david-trauma-care-057
              - generic [ref=e86]:
                - generic [ref=e87]:
                  - textbox "Evidence summary" [ref=e88]:
                    - /placeholder: Evidence summary (optional)
                  - button "Confirm milestone" [ref=e89] [cursor=pointer]
                - link "View proposal + commitment" [ref=e91] [cursor=pointer]:
                  - /url: /h/catalyst/proposals/0x50c11457054bf790270a64db6716192ae45f5c15d690968f4a7d7933bbb490ce
            - generic [ref=e92]:
              - generic [ref=e93]:
                - generic [ref=e94]: Kickoff + first cohort
                - generic [ref=e95]: $12.0k
              - generic [ref=e96]:
                - text: Donor
                - strong [ref=e97]: "Demo Grant Flow Pool #56"
                - text: → Recipient
                - strong [ref=e98]: Fort Collins Network Treasury
                - text: · need
                - link "demo-david-trauma-care-056" [ref=e99] [cursor=pointer]:
                  - /url: /h/catalyst/intents/demo-david-trauma-care-056
              - generic [ref=e100]:
                - generic [ref=e101]:
                  - textbox "Evidence summary" [ref=e102]:
                    - /placeholder: Evidence summary (optional)
                  - button "Confirm milestone" [ref=e103] [cursor=pointer]
                - link "View proposal + commitment" [ref=e105] [cursor=pointer]:
                  - /url: /h/catalyst/proposals/0x85e8b15f526277e1bbccbb4cf2c6cf55533975ca0622ac0c63b88ba2bcd608ba
            - generic [ref=e106]:
              - generic [ref=e107]:
                - generic [ref=e108]: Final report + outcomes
                - generic [ref=e109]: $18.0k
              - generic [ref=e110]:
                - text: Donor
                - strong [ref=e111]: "Demo Grant Flow Pool #56"
                - text: → Recipient
                - strong [ref=e112]: Fort Collins Network Treasury
                - text: · need
                - link "demo-david-trauma-care-056" [ref=e113] [cursor=pointer]:
                  - /url: /h/catalyst/intents/demo-david-trauma-care-056
              - generic [ref=e114]:
                - generic [ref=e115]:
                  - textbox "Evidence summary" [ref=e116]:
                    - /placeholder: Evidence summary (optional)
                  - button "Confirm milestone" [ref=e117] [cursor=pointer]
                - link "View proposal + commitment" [ref=e119] [cursor=pointer]:
                  - /url: /h/catalyst/proposals/0x85e8b15f526277e1bbccbb4cf2c6cf55533975ca0622ac0c63b88ba2bcd608ba
            - generic [ref=e120]:
              - generic [ref=e121]:
                - generic [ref=e122]: Kickoff + first cohort
                - generic [ref=e123]: $12.0k
              - generic [ref=e124]:
                - text: Donor
                - strong [ref=e125]: "Demo Grant Flow Pool #55"
                - text: → Recipient
                - strong [ref=e126]: Fort Collins Network Treasury
                - text: · need
                - link "demo-david-trauma-care-055" [ref=e127] [cursor=pointer]:
                  - /url: /h/catalyst/intents/demo-david-trauma-care-055
              - generic [ref=e128]:
                - generic [ref=e129]:
                  - textbox "Evidence summary" [ref=e130]:
                    - /placeholder: Evidence summary (optional)
                  - button "Confirm milestone" [ref=e131] [cursor=pointer]
                - link "View proposal + commitment" [ref=e133] [cursor=pointer]:
                  - /url: /h/catalyst/proposals/0x91185de9f00f121be3d37eb61b11dc0b0adbd425dbd18f30a40b7f7d99b4d294
            - generic [ref=e134]:
              - generic [ref=e135]:
                - generic [ref=e136]: Final report + outcomes
                - generic [ref=e137]: $18.0k
              - generic [ref=e138]:
                - text: Donor
                - strong [ref=e139]: "Demo Grant Flow Pool #55"
                - text: → Recipient
                - strong [ref=e140]: Fort Collins Network Treasury
                - text: · need
                - link "demo-david-trauma-care-055" [ref=e141] [cursor=pointer]:
                  - /url: /h/catalyst/intents/demo-david-trauma-care-055
              - generic [ref=e142]:
                - generic [ref=e143]:
                  - textbox "Evidence summary" [ref=e144]:
                    - /placeholder: Evidence summary (optional)
                  - button "Confirm milestone" [ref=e145] [cursor=pointer]
                - link "View proposal + commitment" [ref=e147] [cursor=pointer]:
                  - /url: /h/catalyst/proposals/0x91185de9f00f121be3d37eb61b11dc0b0adbd425dbd18f30a40b7f7d99b4d294
            - generic [ref=e148]:
              - generic [ref=e149]:
                - generic [ref=e150]: Kickoff + first cohort
                - generic [ref=e151]: $12.0k
              - generic [ref=e152]:
                - text: Donor
                - strong [ref=e153]: "Demo Grant Flow Pool #54"
                - text: → Recipient
                - strong [ref=e154]: Fort Collins Network Treasury
                - text: · need
                - link "demo-david-trauma-care-054" [ref=e155] [cursor=pointer]:
                  - /url: /h/catalyst/intents/demo-david-trauma-care-054
              - generic [ref=e156]:
                - generic [ref=e157]:
                  - textbox "Evidence summary" [ref=e158]:
                    - /placeholder: Evidence summary (optional)
                  - button "Confirm milestone" [ref=e159] [cursor=pointer]
                - link "View proposal + commitment" [ref=e161] [cursor=pointer]:
                  - /url: /h/catalyst/proposals/0x4b16fd13afc56411810c631eeee3da5890c1ccd6634575b6c23210b394b7b6b8
            - generic [ref=e162]:
              - generic [ref=e163]:
                - generic [ref=e164]: Final report + outcomes
                - generic [ref=e165]: $18.0k
              - generic [ref=e166]:
                - text: Donor
                - strong [ref=e167]: "Demo Grant Flow Pool #54"
                - text: → Recipient
                - strong [ref=e168]: Fort Collins Network Treasury
                - text: · need
                - link "demo-david-trauma-care-054" [ref=e169] [cursor=pointer]:
                  - /url: /h/catalyst/intents/demo-david-trauma-care-054
              - generic [ref=e170]:
                - generic [ref=e171]:
                  - textbox "Evidence summary" [ref=e172]:
                    - /placeholder: Evidence summary (optional)
                  - button "Confirm milestone" [ref=e173] [cursor=pointer]
                - link "View proposal + commitment" [ref=e175] [cursor=pointer]:
                  - /url: /h/catalyst/proposals/0x4b16fd13afc56411810c631eeee3da5890c1ccd6634575b6c23210b394b7b6b8
            - generic [ref=e176]:
              - generic [ref=e177]:
                - generic [ref=e178]: Kickoff + first cohort
                - generic [ref=e179]: $12.0k
              - generic [ref=e180]:
                - text: Donor
                - strong [ref=e181]: "Demo Grant Flow Pool #53"
                - text: → Recipient
                - strong [ref=e182]: Fort Collins Network Treasury
                - text: · need
                - link "demo-david-trauma-care-053" [ref=e183] [cursor=pointer]:
                  - /url: /h/catalyst/intents/demo-david-trauma-care-053
              - generic [ref=e184]:
                - generic [ref=e185]:
                  - textbox "Evidence summary" [ref=e186]:
                    - /placeholder: Evidence summary (optional)
                  - button "Confirm milestone" [ref=e187] [cursor=pointer]
                - link "View proposal + commitment" [ref=e189] [cursor=pointer]:
                  - /url: /h/catalyst/proposals/0x0b6d635a110940f7be70c8e6c97b306eebea1d9e5f47c155a39931334882f55b
            - generic [ref=e190]:
              - generic [ref=e191]:
                - generic [ref=e192]: Final report + outcomes
                - generic [ref=e193]: $18.0k
              - generic [ref=e194]:
                - text: Donor
                - strong [ref=e195]: "Demo Grant Flow Pool #53"
                - text: → Recipient
                - strong [ref=e196]: Fort Collins Network Treasury
                - text: · need
                - link "demo-david-trauma-care-053" [ref=e197] [cursor=pointer]:
                  - /url: /h/catalyst/intents/demo-david-trauma-care-053
              - generic [ref=e198]:
                - generic [ref=e199]:
                  - textbox "Evidence summary" [ref=e200]:
                    - /placeholder: Evidence summary (optional)
                  - button "Confirm milestone" [ref=e201] [cursor=pointer]
                - link "View proposal + commitment" [ref=e203] [cursor=pointer]:
                  - /url: /h/catalyst/proposals/0x0b6d635a110940f7be70c8e6c97b306eebea1d9e5f47c155a39931334882f55b
            - generic [ref=e204]:
              - generic [ref=e205]:
                - generic [ref=e206]: Kickoff + first cohort
                - generic [ref=e207]: $12.0k
              - generic [ref=e208]:
                - text: Donor
                - strong [ref=e209]: "Demo Grant Flow Pool #52"
                - text: → Recipient
                - strong [ref=e210]: Fort Collins Network Treasury
                - text: · need
                - link "demo-david-trauma-care-052" [ref=e211] [cursor=pointer]:
                  - /url: /h/catalyst/intents/demo-david-trauma-care-052
              - generic [ref=e212]:
                - generic [ref=e213]:
                  - textbox "Evidence summary" [ref=e214]:
                    - /placeholder: Evidence summary (optional)
                  - button "Confirm milestone" [ref=e215] [cursor=pointer]
                - link "View proposal + commitment" [ref=e217] [cursor=pointer]:
                  - /url: /h/catalyst/proposals/0x860b362040dfd66e68b465152dc7a24380c76109a9c262b2c3263ee66baa1892
            - generic [ref=e218]:
              - generic [ref=e219]:
                - generic [ref=e220]: Final report + outcomes
                - generic [ref=e221]: $18.0k
              - generic [ref=e222]:
                - text: Donor
                - strong [ref=e223]: "Demo Grant Flow Pool #52"
                - text: → Recipient
                - strong [ref=e224]: Fort Collins Network Treasury
                - text: · need
                - link "demo-david-trauma-care-052" [ref=e225] [cursor=pointer]:
                  - /url: /h/catalyst/intents/demo-david-trauma-care-052
              - generic [ref=e226]:
                - generic [ref=e227]:
                  - textbox "Evidence summary" [ref=e228]:
                    - /placeholder: Evidence summary (optional)
                  - button "Confirm milestone" [ref=e229] [cursor=pointer]
                - link "View proposal + commitment" [ref=e231] [cursor=pointer]:
                  - /url: /h/catalyst/proposals/0x860b362040dfd66e68b465152dc7a24380c76109a9c262b2c3263ee66baa1892
            - generic [ref=e232]:
              - generic [ref=e233]:
                - generic [ref=e234]: Kickoff + first cohort
                - generic [ref=e235]: $12.0k
              - generic [ref=e236]:
                - text: Donor
                - strong [ref=e237]: "Demo Grant Flow Pool #51"
                - text: → Recipient
                - strong [ref=e238]: Fort Collins Network Treasury
                - text: · need
                - link "demo-david-trauma-care-051" [ref=e239] [cursor=pointer]:
                  - /url: /h/catalyst/intents/demo-david-trauma-care-051
              - generic [ref=e240]:
                - generic [ref=e241]:
                  - textbox "Evidence summary" [ref=e242]:
                    - /placeholder: Evidence summary (optional)
                  - button "Confirm milestone" [ref=e243] [cursor=pointer]
                - link "View proposal + commitment" [ref=e245] [cursor=pointer]:
                  - /url: /h/catalyst/proposals/0x0fc5fa0bbd23f4fe8df0b92291b09f627fe8ba9c585f0c27e374b8c4d6d4ab4e
            - generic [ref=e246]:
              - generic [ref=e247]:
                - generic [ref=e248]: Final report + outcomes
                - generic [ref=e249]: $18.0k
              - generic [ref=e250]:
                - text: Donor
                - strong [ref=e251]: "Demo Grant Flow Pool #51"
                - text: → Recipient
                - strong [ref=e252]: Fort Collins Network Treasury
                - text: · need
                - link "demo-david-trauma-care-051" [ref=e253] [cursor=pointer]:
                  - /url: /h/catalyst/intents/demo-david-trauma-care-051
              - generic [ref=e254]:
                - generic [ref=e255]:
                  - textbox "Evidence summary" [ref=e256]:
                    - /placeholder: Evidence summary (optional)
                  - button "Confirm milestone" [ref=e257] [cursor=pointer]
                - link "View proposal + commitment" [ref=e259] [cursor=pointer]:
                  - /url: /h/catalyst/proposals/0x0fc5fa0bbd23f4fe8df0b92291b09f627fe8ba9c585f0c27e374b8c4d6d4ab4e
            - generic [ref=e260]:
              - generic [ref=e261]:
                - generic [ref=e262]: Kickoff + first cohort
                - generic [ref=e263]: $12.0k
              - generic [ref=e264]:
                - text: Donor
                - strong [ref=e265]: "Demo Grant Flow Pool #50"
                - text: → Recipient
                - strong [ref=e266]: Fort Collins Network Treasury
                - text: · need
                - link "demo-david-trauma-care-050" [ref=e267] [cursor=pointer]:
                  - /url: /h/catalyst/intents/demo-david-trauma-care-050
              - generic [ref=e268]:
                - generic [ref=e269]:
                  - textbox "Evidence summary" [ref=e270]:
                    - /placeholder: Evidence summary (optional)
                  - button "Confirm milestone" [ref=e271] [cursor=pointer]
                - link "View proposal + commitment" [ref=e273] [cursor=pointer]:
                  - /url: /h/catalyst/proposals/0x43deb5bd4d7b4a52c1b6d8f6d0812f8febb24776cab479379e80dc01f7fc1ebd
            - generic [ref=e274]:
              - generic [ref=e275]:
                - generic [ref=e276]: Final report + outcomes
                - generic [ref=e277]: $18.0k
              - generic [ref=e278]:
                - text: Donor
                - strong [ref=e279]: "Demo Grant Flow Pool #50"
                - text: → Recipient
                - strong [ref=e280]: Fort Collins Network Treasury
                - text: · need
                - link "demo-david-trauma-care-050" [ref=e281] [cursor=pointer]:
                  - /url: /h/catalyst/intents/demo-david-trauma-care-050
              - generic [ref=e282]:
                - generic [ref=e283]:
                  - textbox "Evidence summary" [ref=e284]:
                    - /placeholder: Evidence summary (optional)
                  - button "Confirm milestone" [ref=e285] [cursor=pointer]
                - link "View proposal + commitment" [ref=e287] [cursor=pointer]:
                  - /url: /h/catalyst/proposals/0x43deb5bd4d7b4a52c1b6d8f6d0812f8febb24776cab479379e80dc01f7fc1ebd
            - generic [ref=e288]:
              - generic [ref=e289]:
                - generic [ref=e290]: Kickoff + first cohort
                - generic [ref=e291]: $12.0k
              - generic [ref=e292]:
                - text: Donor
                - strong [ref=e293]: "Demo Grant Flow Pool #49"
                - text: → Recipient
                - strong [ref=e294]: Fort Collins Network Treasury
                - text: · need
                - link "demo-david-trauma-care-049" [ref=e295] [cursor=pointer]:
                  - /url: /h/catalyst/intents/demo-david-trauma-care-049
              - generic [ref=e296]:
                - generic [ref=e297]:
                  - textbox "Evidence summary" [ref=e298]:
                    - /placeholder: Evidence summary (optional)
                  - button "Confirm milestone" [ref=e299] [cursor=pointer]
                - link "View proposal + commitment" [ref=e301] [cursor=pointer]:
                  - /url: /h/catalyst/proposals/0x451dd290ba98164c7813f09590098d6413f5f681695f949c6400f3f0d7468353
            - generic [ref=e302]:
              - generic [ref=e303]:
                - generic [ref=e304]: Final report + outcomes
                - generic [ref=e305]: $18.0k
              - generic [ref=e306]:
                - text: Donor
                - strong [ref=e307]: "Demo Grant Flow Pool #49"
                - text: → Recipient
                - strong [ref=e308]: Fort Collins Network Treasury
                - text: · need
                - link "demo-david-trauma-care-049" [ref=e309] [cursor=pointer]:
                  - /url: /h/catalyst/intents/demo-david-trauma-care-049
              - generic [ref=e310]:
                - generic [ref=e311]:
                  - textbox "Evidence summary" [ref=e312]:
                    - /placeholder: Evidence summary (optional)
                  - button "Confirm milestone" [ref=e313] [cursor=pointer]
                - link "View proposal + commitment" [ref=e315] [cursor=pointer]:
                  - /url: /h/catalyst/proposals/0x451dd290ba98164c7813f09590098d6413f5f681695f949c6400f3f0d7468353
            - generic [ref=e316]:
              - generic [ref=e317]:
                - generic [ref=e318]: Kickoff + first cohort
                - generic [ref=e319]: $12.0k
              - generic [ref=e320]:
                - text: Donor
                - strong [ref=e321]: "Demo Grant Flow Pool #48"
                - text: → Recipient
                - strong [ref=e322]: Fort Collins Network Treasury
                - text: · need
                - link "demo-david-trauma-care-048" [ref=e323] [cursor=pointer]:
                  - /url: /h/catalyst/intents/demo-david-trauma-care-048
              - generic [ref=e324]:
                - generic [ref=e325]:
                  - textbox "Evidence summary" [ref=e326]:
                    - /placeholder: Evidence summary (optional)
                  - button "Confirm milestone" [ref=e327] [cursor=pointer]
                - link "View proposal + commitment" [ref=e329] [cursor=pointer]:
                  - /url: /h/catalyst/proposals/0x2f99771f920fa2d2688197a0cf11237a577096f43222a50873439e540dda304e
            - generic [ref=e330]:
              - generic [ref=e331]:
                - generic [ref=e332]: Final report + outcomes
                - generic [ref=e333]: $18.0k
              - generic [ref=e334]:
                - text: Donor
                - strong [ref=e335]: "Demo Grant Flow Pool #48"
                - text: → Recipient
                - strong [ref=e336]: Fort Collins Network Treasury
                - text: · need
                - link "demo-david-trauma-care-048" [ref=e337] [cursor=pointer]:
                  - /url: /h/catalyst/intents/demo-david-trauma-care-048
              - generic [ref=e338]:
                - generic [ref=e339]:
                  - textbox "Evidence summary" [ref=e340]:
                    - /placeholder: Evidence summary (optional)
                  - button "Confirm milestone" [ref=e341] [cursor=pointer]
                - link "View proposal + commitment" [ref=e343] [cursor=pointer]:
                  - /url: /h/catalyst/proposals/0x2f99771f920fa2d2688197a0cf11237a577096f43222a50873439e540dda304e
          - generic [ref=e344]:
            - heading "●Awaiting your approval to release (0)" [level=2] [ref=e345]
            - generic [ref=e346]: No tranches ready for your release approval.
      - generic:
        - generic:
          - generic: "Y"
          - generic:
            - generic: Your Agent
            - text: Assistant
          - button "Close agent panel": ✕
        - generic:
          - generic: No suggestions right now. You're doing great!
        - generic:
          - textbox "Ask your agent..."
          - button "Send"
    - button "Log activity" [ref=e347] [cursor=pointer]: +
```

# Test source

```ts
  79  |   const pub = createPublicClient({ chain: foundry, transport: http(RPC) })
  80  |   return (await pub.readContract({
  81  |     address: USDC, abi: mockUsdcAbi, functionName: 'balanceOf', args: [address],
  82  |   })) as bigint
  83  | }
  84  | 
  85  | async function resolveFortCollinsTreasury(): Promise<Address> {
  86  |   // The catalyst seed deploys + registers Fort Collins Network and its
  87  |   // sa:hasTreasury treasury. We resolve via the on-chain resolver so we
  88  |   // don't bake addresses into the test.
  89  |   const resolverAddress = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as Address | undefined
  90  |   if (!resolverAddress) throw new Error('AGENT_ACCOUNT_RESOLVER_ADDRESS not set')
  91  |   const pub = createPublicClient({ chain: foundry, transport: http(RPC) })
  92  |   // First find the org by displayName via agentCount enumeration.
  93  |   const resolverAbi = [
  94  |     { type: 'function', name: 'agentCount', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  95  |     { type: 'function', name: 'getAgentAt', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }], stateMutability: 'view' },
  96  |     { type: 'function', name: 'getStringProperty', inputs: [{ type: 'address' }, { type: 'bytes32' }], outputs: [{ type: 'string' }], stateMutability: 'view' },
  97  |     { type: 'function', name: 'getAddressProperty', inputs: [{ type: 'address' }, { type: 'bytes32' }], outputs: [{ type: 'address' }], stateMutability: 'view' },
  98  |   ] as const
  99  |   const ATL_DISPLAY = keccak256(toBytes('atl:displayName'))
  100 |   const SA_HAS_TREASURY = keccak256(toBytes('sa:hasTreasury'))
  101 |   const count = (await pub.readContract({ address: resolverAddress, abi: resolverAbi, functionName: 'agentCount' })) as bigint
  102 |   for (let i = 0n; i < count; i++) {
  103 |     const addr = (await pub.readContract({
  104 |       address: resolverAddress, abi: resolverAbi, functionName: 'getAgentAt', args: [i],
  105 |     })) as Address
  106 |     const name = await pub.readContract({
  107 |       address: resolverAddress, abi: resolverAbi, functionName: 'getStringProperty', args: [addr, ATL_DISPLAY],
  108 |     }).catch(() => '') as string
  109 |     if (name === FCN_TREASURY_NAME) {
  110 |       const treasury = (await pub.readContract({
  111 |         address: resolverAddress, abi: resolverAbi, functionName: 'getAddressProperty', args: [addr, SA_HAS_TREASURY],
  112 |       })) as Address
  113 |       if (treasury && treasury !== '0x0000000000000000000000000000000000000000') return treasury
  114 |       return addr // shouldn't happen with the new seed, but fall through cleanly
  115 |     }
  116 |   }
  117 |   throw new Error(`Fort Collins Network not found in resolver — seed catalyst first`)
  118 | }
  119 | 
  120 | test.describe('Spec 006 — grant flow E2E (validator + steward UI)', () => {
  121 |   test.beforeEach(async () => {
  122 |     test.setTimeout(300_000) // 5 min — accommodates dev compile + chain waits
  123 |   })
  124 | 
  125 |   test('Sarah attests both milestones, Maria releases both, Fort Collins treasury grows by $30k', async ({ page }) => {
  126 |     // ── Setup: seed the on-chain state up to (but not including) attest/release ──
  127 |     // We invoke the existing seed with STOP_AT_COMMITMENT=1 so it lays
  128 |     // the deterministic groundwork and stops at the point the UI test
  129 |     // takes over. The inbox accumulates across seed runs (GraphDB isn't
  130 |     // wiped per-run), so we extract THIS run's commitment subject from
  131 |     // the seed's stdout and scope every UI interaction to that row.
  132 |     console.log('seeding fresh grant-flow scenario (STOP_AT_COMMITMENT=1) …')
  133 |     let seedStdout = ''
  134 |     try {
  135 |       seedStdout = execSync(
  136 |         `cd "${REPO_ROOT}/apps/web" && STOP_AT_COMMITMENT=1 pnpm exec tsx "${REPO_ROOT}/scripts/seed-grant-flow-demo.ts"`,
  137 |         { stdio: 'pipe', timeout: 180_000 },
  138 |       ).toString()
  139 |     } catch (e) {
  140 |       console.error('seed failed:', (e as Error).message?.slice(0, 1000))
  141 |       throw e
  142 |     }
  143 |     const subjectMatch = seedStdout.match(/COMMITMENT_SUBJECT=(0x[0-9a-fA-F]{64})/)
  144 |     if (!subjectMatch) {
  145 |       throw new Error('seed did not emit COMMITMENT_SUBJECT — cannot scope UI selectors')
  146 |     }
  147 |     const thisRunSubject = subjectMatch[1].toLowerCase()
  148 |     console.log(`scoping UI assertions to commitment ${thisRunSubject}`)
  149 | 
  150 |     const fortCollinsTreasury = await resolveFortCollinsTreasury()
  151 |     const balanceBefore = await readUsdcBalance(fortCollinsTreasury)
  152 |     console.log(`Fort Collins Treasury at ${fortCollinsTreasury}: $${(Number(balanceBefore) / 1_000_000).toLocaleString()}`)
  153 | 
  154 |     // ── Phase A: Sarah (validator) attests both milestones via UI ──
  155 |     await demoLogin(page, 'cat-user-005') // Sarah Thompson
  156 |     await page.goto(`${BASE}/h/catalyst/tasks`, { waitUntil: 'networkidle' })
  157 | 
  158 |     // Inbox header should render (renamed to "Funding milestones" in Stream A-E UX overhaul)
  159 |     await expect(page.getByRole('heading', { name: /Funding milestones/i })).toBeVisible()
  160 | 
  161 |     // Scope every selector to rows for THIS run's commitment. Old runs
  162 |     // leave stale pending rows in the inbox that would otherwise capture
  163 |     // our clicks.
  164 |     const scopeAttest = page.locator(`[data-commitment-subject="${thisRunSubject}"][data-task-kind="attestation"]`)
  165 |     const initialAttestRows = await scopeAttest.count()
  166 |     expect(initialAttestRows, 'expected 2 pending attestations for this run on Sarah\'s inbox').toBeGreaterThanOrEqual(2)
  167 | 
  168 |     // Click each attestation button within scope, re-querying after each
  169 |     // navigation since the page reloads on success.
  170 |     for (let i = 0; i < 2; i++) {
  171 |       const scope = page.locator(`[data-commitment-subject="${thisRunSubject}"][data-task-kind="attestation"]`)
  172 |       const remaining = await scope.count()
  173 |       if (remaining === 0) break
  174 |       const row = scope.first()
  175 |       const evidenceInput = row.getByPlaceholder(/Evidence summary/i)
  176 |       if (await evidenceInput.count() > 0) {
  177 |         await evidenceInput.fill(`E2E run — milestone ${i + 1} attested by Sarah`)
  178 |       }
> 179 |       await row.getByRole('button', { name: /Attest delivered/i }).click()
      |                                                                    ^ Error: locator.click: Test timeout of 300000ms exceeded.
  180 |       await page.waitForLoadState('networkidle', { timeout: 30_000 })
  181 |     }
  182 | 
  183 |     // After 2 attestations, Sarah's inbox should be empty for attestations,
  184 |     // and Maria (when she logs in) should see 2 release rows.
  185 | 
  186 |     // ── Phase B: Maria (steward) approves + releases both milestones ──
  187 |     await demoLogin(page, 'cat-user-001') // Maria Gonzalez
  188 |     await page.goto(`${BASE}/h/catalyst/tasks`, { waitUntil: 'networkidle' })
  189 | 
  190 |     await expect(page.getByRole('heading', { name: /Funding milestones/i })).toBeVisible()
  191 | 
  192 |     const scopeRelease = page.locator(`[data-commitment-subject="${thisRunSubject}"][data-task-kind="release"]`)
  193 |     const initialReleaseRows = await scopeRelease.count()
  194 |     expect(initialReleaseRows, 'expected 2 pending releases for this run on Maria\'s inbox').toBeGreaterThanOrEqual(2)
  195 | 
  196 |     for (let i = 0; i < 2; i++) {
  197 |       const scope = page.locator(`[data-commitment-subject="${thisRunSubject}"][data-task-kind="release"]`)
  198 |       const remaining = await scope.count()
  199 |       if (remaining === 0) break
  200 |       await scope.first().getByRole('button', { name: /Approve & release/i }).click()
  201 |       await page.waitForLoadState('networkidle', { timeout: 60_000 })
  202 |     }
  203 | 
  204 |     // ── Phase C: verify on-chain ──
  205 |     const balanceAfter = await readUsdcBalance(fortCollinsTreasury)
  206 |     const delta = balanceAfter - balanceBefore
  207 |     const THIRTY_K_USDC = 30_000n * 10n ** 6n
  208 |     expect(delta, `Fort Collins Treasury should grow by exactly $30k — got delta ${delta.toString()}`)
  209 |       .toBe(THIRTY_K_USDC)
  210 |     console.log(`Fort Collins Treasury after: $${(Number(balanceAfter) / 1_000_000).toLocaleString()}  (Δ +$${(Number(delta) / 1_000_000).toLocaleString()})`)
  211 |   })
  212 | })
  213 | 
```