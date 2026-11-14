export const SNAPSHOT = {
  date:'2026-11-08', source:'GitHub connector repository snapshot; NOT a deployed build or CI receipt',
  heads:[
    { id:'wasm', repo:'ores-truffle-oreslang/oreslang-source.wasm', sha:'2c6ce5988592080ea47b8877e2b8c1d3df5cb9bd', role:'LLVM IR → Clang wasm32 bridge; Node V8 WebAssembly guest host' },
    { id:'rs', repo:'ores-truffle-oreslang/oreslang-source.rs', sha:'e0b8124c69d486c2bd919fb2d0124ea4eb87159e', role:'Independent native Cranelift compiler prototype' },
    { id:'js', repo:'ores-truffle-oreslang/oreslang-source.js', sha:'b341ee620694db8c211e15cf36330a408373854a', role:'ESM transpiler and trusted browser/Node Worker reference' },
    { id:'site', repo:'atto-lang/atto-lang.github.io', sha:'84c4388fb5a9ba88abab4249c068a628df8002ac', role:'Playground site default-branch snapshot; not deployed revision' },
    { id:'playground', repo:'atto-lang/atto-playground', sha:'75d1eca52301237b73bbf79e8465922fe7b1505a', role:'Standalone playground source; separate from public site' }
  ],
  compiler:{ source_repository:'atto-lang/atto-source.rs', source_head:'061dc2f308239357bd9c6bc3bcefdb50c6ddff2d', source_tree:'72b481cd385034b0b5d1d40ae7fe9ce4beaa9e27', compiler_sha256:'91209eac9d875e3574d5f87a9a2e6e46f7622daa1169b79d31213f31ad78b657', compiler_bytes:146384, compiler_abi:2, guest_abi:'atto.browser.guest.v1', target:'wasm32-unknown-unknown' }
};
export const ROUTES = {
  rust:{ label:'RUST → WASM', kicker:'Rust compiler compiled to Wasm, emitting guest Wasm', note:'The public playground vendors atto-source.rs, NOT oreslang-source.rs. Direct browser Wasm guest execution is a documented subset, not actor parity.',
    browser:[
      ['Atto source','Source','Current','AttoLang .atto source; legacy .ores remains compatible at repository level.','No actor/class lowering in shipped browser subset.'],
      ['atto-source.rs','Compiler','Documented','A separate Rust compiler compiled to wasm32-unknown-unknown, vendored as atto_compiler.wasm.','Do not confuse with oreslang-source.rs (native Cranelift prototype).'],
      ['Guest .wasm','Artifact','Documented','Compiler produces a Wasm binary with bounded stdout host imports.','Compiler supports subset only. Source actor syntax is rejected.'],
      ['Guest Worker','Host','Documented','Disposable browser Web Worker invokes the browser WebAssembly APIs.','No Wasmtime in browser; Worker is not process isolation.'],
      ['Actor arenas','Target','Target','One Worker per tenant; multiple actor instances, bounded heaps/stacks; memory32 offsets.','Separate Wasm instance memory or explicit checked arenas required.']
    ],
    node:[
      ['Atto source','Source','Current','Input is .atto source with a limited browser compiler subset.','Legacy .ores source compatibility remains a repository goal.'],
      ['Compiler .wasm','Compiler','Documented','Rust compiler wasm32 module can be invoked using Node WebAssembly APIs.','Distinct from oreslang-source.rs native Cranelift compiler.'],
      ['Guest .wasm','Artifact','Documented','Generated Wasm guest bytes.','Only guest ABI v1 and language subset admitted.'],
      ['Node WebAssembly','Host','Documented','Node V8 WebAssembly engine executes guest in disposable worker_threads.','Native Wasmtime embedding is a separate option, not the current proof.'],
      ['Tenant actors','Target','Target','Implement tenant-host worker with bounded per-actor Wasm isolation.','Actor scheduler, quotas, ownership and stacks unverified.']
    ]
  },
  direct:{label:'DIRECT WASM',kicker:'Native LLVM/Clang emits core Wasm for a Node host',note:'oreslang-source.wasm currently runs an external LLVM compiler and Clang; it is NOT a Wasmtime browser runtime or browser Rust compiler.',
    browser:[
      ['Atto / .ores','Source','Current','Compiler accepts .atto or legacy .ores source via native LLVM frontend.','The native frontend must run before browser deployment.'],
      ['Native LLVM + Clang','Build','Unsupported','oreslang-llvmc → LLVM IR → Clang wasm32 runs outside the browser.','No browser native LLVM frontend is supplied by this bridge.'],
      ['Core .wasm','Artifact','Documented','Pure Wasm module: zero imports, memory export and main: () → i64.','Binary format is browser-compatible subject to feature gates and host ABI.'],
      ['WebAssembly API','Host','Target','Browser could instantiate admitted core Wasm modules in Web Workers.','Current bridge documents disposable Node workers, not browser guest receipts.'],
      ['Tenant actors','Target','Target','Actor runtime, per-actor stack and arenas are not in the current core ABI.','No full source-level actor lowering.']
    ],
    node:[
      ['Atto / .ores','Source','Current','Accept canonical .atto and legacy .ores inputs.','Exact LLVM compiler binary must be pinned.'],
      ['LLVM → Clang','Compiler','Documented','External native oreslang-llvmc emits LLVM IR; Clang links wasm32.','Compiler integration is opt-in; stubs do not prove language parity.'],
      ['Core .wasm','Artifact','Documented','Narrow import-free core module, bounded linear memory, main i64.','No WASI, channels, actors or host I/O.'],
      ['Node worker_threads','Host','Documented','V8 native WebAssembly in disposable Node worker threads with deadline.','Not Wasmtime; quotas module-local, not global tenant isolation.'],
      ['Tenant actors','Target','Target','Per-tenant admission broker and actor runtimes pending.','No actor arena/stack execution or cancellation proof.']
    ]
  },
  js:{label:'JS TRANSPILED',kicker:'Atto subset source → ESM; trusted JS Worker execution',note:'oreslang-source.js emits JavaScript, not Wasm. Existing reference isolates a serial host Worker per actor, not one worker per tenant.',
    browser:[
      ['Atto / .ores','Source','Current','Experimental scalar and program-v2 compiler accepts a limited language subset.','Actor definitions, ownership and concurrency lowering unsupported.'],
      ['oreslang-source.js','Compiler','Documented','Compiles source into validated IR and JavaScript ESM.','Provisional i64 semantics; parity pending.'],
      ['ES module','Artifact','Documented','Generated JavaScript ESM with BigInt arithmetic.','JS uses GC, not a zero-GC Wasm arena.'],
      ['Module Web Worker','Host','Documented','Trusted module Worker actor reference with serial message protocol.','Worker is not an adversarial JS sandbox.'],
      ['Tenant Worker pool','Target','Target','Replace per-actor Worker model with per-tenant scheduler where appropriate.','No typed source actors, arena isolation or Wasm actors.']
    ],
    node:[
      ['Atto / .ores','Source','Current','Scalar/program-v2 .ores source input.','No full language support.'],
      ['oreslang-source.js','Compiler','Documented','Native Node.js 22 ESM compiler.','Java semantics and actor lowering incomplete.'],
      ['ES module','Artifact','Documented','JavaScript ESM generated with BigInt values.','May execute only trusted reviewed ESM.'],
      ['worker_threads','Host','Documented','Serial trusted-host actor model using Node worker_threads.','No OS isolation or malicious code sandbox.'],
      ['Tenant Worker pool','Target','Target','Scheduler, ownership and actor-per-tenant isolation are future work.','No GC-free heap guarantee for JS implementation.']
    ]
  }
};
export const COMPARISON = [
 ['Actual compiler','atto-source.rs (browser vendored)','oreslang-llvmc + Clang (native)','oreslang-source.js (Node ESM)'],
 ['oreslang-source.rs','Independent Cranelift → native object; not the vendor compiler','Not a dependency','Not a dependency'],
 ['Generated artifact','core guest .wasm','core guest .wasm','JavaScript ES module'],
 ['Browser execution','Yes, source subset via native WebAssembly APIs','Possible for admitted bytes; bridge browser CI unverified','Yes, trusted ESM in module Web Workers'],
 ['Node execution','Node WebAssembly + worker_threads test path','Node WebAssembly + worker_threads documented','Node ESM + worker_threads documented'],
 ['Wasmtime in browser','No · browser WebAssembly engine','No · browser WebAssembly engine','Not applicable'],
 ['Workers today','Disposable compiler + guest workers','Disposable Node worker per guest execution','Worker per actor reference, serial'],
 ['Per-tenant worker + many actors','TARGET · unimplemented','TARGET · unimplemented','TARGET · unimplemented'],
 ['Per-actor Wasm heaps/stacks','TARGET · no source-backed proof','TARGET · no actor ABI','Not Wasm; JS GC objects'],
 ['Heap pointer width','Wasm32 memory offsets are 32-bit','Wasm32 memory offsets are 32-bit','JS references engine-defined'],
 ['Trust boundary','Host imports explicitly allowed; Worker ≠ OS sandbox','Zero guest imports; Worker ≠ OS sandbox','Trusted JS modules only; Worker ≠ sandbox']
];
export const EVIDENCE = [
  {id:'browser-rust',name:'Browser Rust compiler',sub:'atto-source.rs → atto_compiler.wasm',compile:'documented',browser:'documented',node:'documented',actor:'missing',release:'receipt present / deployed unverified'},
  {id:'wasm',name:'oreslang-source.wasm',sub:'Native LLVM bridge · core Wasm host',compile:'documented',browser:'missing',node:'documented',actor:'missing',release:'not supplied'},
  {id:'rs',name:'oreslang-source.rs',sub:'Cranelift native object compiler',compile:'documented',browser:'unsupported',node:'missing',actor:'missing',release:'not applicable'},
  {id:'js',name:'oreslang-source.js',sub:'ESM transpiler · serial Worker reference',compile:'documented',browser:'documented',node:'documented',actor:'missing',release:'not supplied'},
  {id:'release',name:'Public Pages deployment',sub:'atto-lang.github.io/play/',compile:'documented',browser:'missing',node:'missing',actor:'missing',release:'deployed digest unverified'}
];
export const TASKS = [
 {id:'T01',priority:'P0',title:'Pin the deployed playground release',area:'Provenance',desc:'Fetch HTTPS site assets and compare SHA-256 against a reviewed release manifest and compiler receipt; capture Pages build/deploy SHA.',accept:'Public URL + Pages deploy run/attempt + actual bytes + exact compiler/guest digest; fail a one-byte mutation.'},
 {id:'T02',priority:'P0',title:'Run real Chromium guest and Worker receipt',area:'Browser',desc:'Run compiled Atto subset source in a disposable browser guest Worker, not a source-free canary.',accept:'Executed browser steps > 0, exact source/compiler hashes, output + negative import/trap/mutation evidence.'},
 {id:'T03',priority:'P0',title:'Run exact-head Node guest receipt',area:'Node',desc:'Run Node host tests for LLVM bridge and JS ESM runtime against pinned repository and fixture commits.',accept:'Record commit + tree + compiler binary hash + job/attempt/steps + positive and negative guest results.'},
 {id:'T04',priority:'P0',title:'Prove real actors are rejected in browser subset',area:'Compiler',desc:'Add fail-closed browser fixtures for class, actor, async and cross-tenant capabilities.',accept:'No successful output artifact for rejected syntax; stable diagnostics and a real Chromium receipt.'},
 {id:'T05',priority:'P0',title:'Specify tenant ↔ actor memory boundary',area:'Isolation',desc:'Decide between separate Wasm instance per actor or rigorously checked private regions within one tenant instance.',accept:'An ADR with attacker model, pointer bounds, quarantine and negative cross-actor write tests.'},
 {id:'T06',priority:'P1',title:'Prototype one Worker per tenant, two Wasm actor instances',area:'Isolation',desc:'Implement tenant-scoped scheduler with two separately instantiated actor modules/memories; verify no cross-instance reads.',accept:'Two independent memories, bounded queue, tenant teardown and generation fencing; real browser test.'},
 {id:'T07',priority:'P1',title:'Implement u32 actor heap handles and checks',area:'Memory',desc:'Use 32-bit offsets/handles even on 64-bit hosts. Prove allocation bounds, overflow, stale generations and zeroized reclamation.',accept:'Negative forged/overflow/stale pointer tests and fixed-width layout receipt for Wasm32 and native.'},
 {id:'T08',priority:'P1',title:'Prove isolated actor continuation stacks',area:'Stacks',desc:'Define bounded actor-owned frame storage, trap-to-supervisor routing and non-poisoning sibling actor execution.',accept:'One actor exhausts stack; its sibling keeps working; no shared stack corruption; bounded recovery.'},
 {id:'T09',priority:'P1',title:'Unify Node/browser host admission policy',area:'Runtime',desc:'Explicit import allowlist, quotas, deadlines, cancellation, output bounds and no unsupported Wasmtime assumptions.',accept:'Shared adversarial fixture vectors with executed Node and Chromium receipts.'},
 {id:'T10',priority:'P1',title:'Differential JS ESM versus Wasm guest semantics',area:'Conformance',desc:'Compare i64 overflow, immutable bindings, function signatures and unsupported actor syntax.',accept:'Versioned scalar corpus; exact-head JS/LLVM/browser compiler outputs, mismatches fail closed.'},
 {id:'T11',priority:'P2',title:'Design cross-backend actor message ABI',area:'Runtime',desc:'Data-only Sendable messages, actor-local scheduler ownership, supervisor lifecycle and cancellation.',accept:'A bounded, versioned ABI and multi-tenant hostile-message fixtures.'},
 {id:'T12',priority:'P2',title:'Integrate dashboard in explicit Pages release allowlist',area:'Deployment',desc:'Review release packaging and disclosure gates; do not bypass the existing compiler binary approval policy.',accept:'New route copied only via reviewed allowlist; deployed digest readback + Chrome/Node checks > 0.'}
];
export const CHECKLISTS = [
 {id:'browser',label:'Browser HTTPS',name:'Browser HTTPS release smoke',intro:'Real HTTPS static deployment; Chromium or another named browser build. Source-free probes alone do not qualify.',items:[
  'Record exact public URL, browser build, UTC timestamp and site deployment SHA.',
  'Read back deployed release manifest and hash every compiler/runtime asset.',
  'Compare compiler source head/tree and binary digest to pinned receipt.',
  'Fetch compiler .wasm on HTTPS and verify correct MIME/type and SHA-256.',
  'Compile a supported AttoLang fixture in a disposable compiler Worker.',
  'Run generated guest Wasm with the intended import allowlist and inspect actual output.',
  'Reject actor/class syntax outside the admitted subset with no published Wasm.',
  'Reject a one-byte modified compiler/guest module before execution.',
  'Prove guest timeout or trap kills only its Worker; a subsequent run succeeds.',
  'Capture real browser test IDs, nonzero executed steps, run attempt and artifact digests.' ]},
 {id:'node',label:'Node host',name:'Node.js compiler and guest smoke',intro:'Node 22+ runtime; distinguish LLVM-based Wasm host, native Cranelift object and JS transpiler.',items:[
  'Record Node version, OS/arch, exact source SHA/tree and workflow attempt.',
  'Use a real pinned LLVM compiler binary, not a fake/stub adapter.',
  'Build .atto/.ores → LLVM IR → clang wasm32 and record guest digest.',
  'Run narrow zero-import Wasm main() in a disposable Node worker_threads host.',
  'Reject forbidden imports, memory bounds, start/table and unsupported opcodes.',
  'Verify worker deadline, cancellation and next-run recovery under adversarial inputs.',
  'Compile same scalar source to ESM and execute only trusted module in Node Worker.',
  'Compare scalar i64 semantics and reject unsupported syntax.',
  'Save exact test cases, executed steps >0, stdout, exit code and negative mutation receipt.' ]},
 {id:'isolation',label:'Actor isolation',name:'Multi-actor tenant isolation smoke',intro:'TARGET acceptance plan; do not mark runtime implementation complete because this checklist is checked.',items:[
  'Start one named browser Web Worker for tenant A; spawn two actor Wasm instances inside.',
  'Prove actors have distinct Wasm.Memory objects or independently enforced access bounds.',
  'Prove each actor has u32 heap offset/handle representation, even on 64-bit host.',
  'Attempt forged handle / stale generation / out-of-bounds cross-actor write; fail closed.',
  'Exhaust actor A heap quota and preserve actor B execution.',
  'Overflow actor A continuation stack and preserve actor B execution.',
  'Test actor A cancellation, teardown and memory reclamation without tenant B effects.',
  'Test FIFO messages, bounded backpressure and no suspended carrier thread.',
  'Confirm Wasmtime is not loaded in browser and JS Wasm APIs run the guest.',
  'Bind browser/Node executed receipts to exact runtime, compiler and deployed asset hashes.' ]},
 {id:'release',label:'Release gate',name:'Deployment provenance & disclosure',intro:'A green test is not an independently approved deployment. Keep positive and negative proof together.',items:[
  'Require independent review of release binary disclosure and branch policy.',
  'Pin exact compiler source HEAD, tree SHA, Rust toolchain, Wasm build target and binary hash.',
  'Pin runtime source HEAD separately from compiler HEAD and guest artifact.',
  'Build only enumerated static files; reject symlinks and unintended secrets.',
  'Generate immutable manifest with SHA-256 of HTML, JS, CSS, Wasm and receipts.',
  'Run real Chromium and Node smoke with nonzero job steps on the release commit.',
  'Verify a changed compiler byte or mismatched manifest fails the release.',
  'Deploy via reviewed manual gate; record action run ID and attempt.',
  'Fetch deployed HTTPS bytes with no-cache and compare every release digest.',
  'Record known unsupported features and actor isolation gaps next to the release.' ]}
];
