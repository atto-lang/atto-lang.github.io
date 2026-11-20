/** Editorial design comparison. AttoLang support is not compiler-conformance evidence. */
export const matrixColumns = [
  { key: "erlang", label: "Erlang" },
  { key: "rust", label: "Rust" },
  { key: "oreslang", label: "AttoLang (direction)" },
  { key: "others", label: "Other languages" },
];

export const matrixRows = [
  {
    "id": "type-system",
    "feature": "Type system",
    "erlang": "Dynamically typed Erlang terms with pattern matching, optional typespec annotations and Dialyzer success typing. These give useful inferred analyses but do not turn Erlang into a gradual static type system with guaranteed compile-time checks.",
    "rust": "Statically typed with strong local type inference, nominal types, traits, generics and exhaustive enums. Inference removes many annotations without weakening static checks; ordinary Rust does not provide gradual dynamic typing.",
    "oreslang": "Design: static nominal/structural contracts and inferred local types alongside explicit annotations, generics and typed actor mail. Gradual typing (controlled dynamic-to-static boundaries with runtime checks) is a separate research question, not a verified mode; backend conformance remains unverified.",
    "others": "OCaml/Gleam use inferred static types; Go infers some declarations; Python typing uses Any as a gradual form while its runtime stays dynamic. TypeScript offers gradual-style adoption around any/unknown and JavaScript interop, with limitations.",
    "status": "design"
  },
  {
    "id": "hot-reload",
    "feature": "Hot reloading in production",
    "erlang": "OTP supports versioned module loading and release upgrades, with upgrade scripts and state migration; some VM upgrades require restarts.",
    "rust": "No language/runtime-wide hot code replacement; rolling restarts, dylib/plugin designs or process handover are typical.",
    "oreslang": "Planned: stage a new actor/code generation, route new work, drain old instances and roll back; production-safe reload is not verified.",
    "others": "Elixir inherits BEAM upgrades; JVM/.NET offer limited hot-swap/reload tooling, not universal stateful production upgrades.",
    "status": "research"
  },
  {
    "id": "build-system",
    "feature": "Build system",
    "erlang": "erlc and OTP releases; rebar3 and Mix (Elixir) organize builds and dependencies.",
    "rust": "Cargo provides dependency resolution, builds, workspaces, testing and packaging; rustc compiles crates.",
    "oreslang": "Compiler CLI, reproducible multi-backend builds and native-image/LLVM pipelines are under development; no parity claim.",
    "others": "Go toolchain/modules, Gradle/Maven, CMake/Meson and dotnet build are established alternatives.",
    "status": "design"
  },
  {
    "id": "borrow-checking",
    "feature": "Borrow checking",
    "erlang": "No compile-time affine ownership or borrow checker; actors exchange immutable terms and use process isolation.",
    "rust": "Compiler-enforced ownership, shared/mutable borrowing and lifetime checking, including across async contexts.",
    "oreslang": "Design: checked rt borrow, rt mut borrow, rt take and rt share with actor isolation and suspension-aware loans; conformance is unverified.",
    "others": "C++ has RAII without Rust-equivalent universal borrow checks; Swift enforces some exclusivity rules.",
    "status": "design"
  },
  {
    "id": "memory-safety",
    "feature": "Memory safety",
    "erlang": "Ordinary BEAM terms are managed and isolated by processes, preventing many pointer and lifetime errors in Erlang code. Native implemented functions (NIFs), drivers and ports have different trust and failure boundaries.",
    "rust": "Safe Rust enforces ownership, borrowing and bounds checks to prevent many memory errors; unsafe Rust, native libraries and FFI still require manually upheld invariants. Memory safety is not a guarantee of logic or availability safety.",
    "oreslang": "Design goal: ownership/borrow checks, generation-checked actor handles, single actor-owned state schema and isolated mutable arenas. No end-to-end backend memory-safety certification or FFI containment proof is published.",
    "others": "Java, C# and Go provide managed memory safety with escape hatches; C/C++ provide low-level control but generally require additional discipline and tooling.",
    "status": "design"
  },
  {
    "id": "garbage-collection",
    "feature": "Garbage collection",
    "erlang": "BEAM normally performs garbage collection on individual process heaps; large binaries can be shared via reference counting.",
    "rust": "No mandatory tracing GC; deterministic drops/RAII, ownership, and reference-counted options such as Arc.",
    "oreslang": "Target: LLVM actor-owned arenas/heaps with no tracing GC; GraalVM uses actor-owned regions alongside managed GC. These are distinct profiles, not guaranteed results.",
    "others": "Go, Java, C# use managed GC; C/C++ use explicit/RAII lifetime strategies.",
    "status": "design"
  },
  {
    "id": "compressed-addressing",
    "feature": "32-bit pointers / compressed arena offsets",
    "erlang": "Term and pointer representation depends on the BEAM build and target word size. A 64-bit BEAM is not a universal 32-bit-pointer or compressed-reference system; term tagging and shared binaries affect real memory use.",
    "rust": "Native pointers follow the target architecture (32-bit target: generally 4-byte thin pointers; 64-bit target: generally 8). Applications can explicitly use u32 indices/relative offsets in bounded arenas; Rust does not automatically compress arbitrary pointers.",
    "oreslang": "Research target: store checked 32-bit offsets or handles into actor-owned regions no larger than 4 GiB, with bounds, alignment and generation validation. A 64-bit process still uses native-width pointers at FFI/OS boundaries. Savings and overflow safety require proof.",
    "others": "JVM compressed ordinary object pointers may reduce reference footprint; WebAssembly wasm32 uses 32-bit linear-memory addressing; C/C++ can implement compact handles manually. Object/layout overhead can outweigh pointer savings.",
    "status": "research"
  },
  {
    "id": "soft-real-time",
    "feature": "Soft real time",
    "erlang": "BEAM reductions, per-process scheduling and supervision make soft-real-time I/O a well-established strength; no fixed deadline guarantee.",
    "rust": "Can achieve low latency with async runtimes or dedicated threads, but scheduling and allocation require deliberate engineering.",
    "oreslang": "Target: bounded actor admission, fairness, preemption checkpoints and runtime backpressure; latency SLOs need measured proof.",
    "others": "Go, Java and .NET support latency-sensitive services with tuning and observability.",
    "status": "design"
  },
  {
    "id": "hard-real-time",
    "feature": "Hard real time",
    "erlang": "General BEAM/OTP is not a hard-real-time platform and does not certify worst-case deadlines.",
    "rust": "Possible on suitable RTOS or real-time Linux with bounded code and audited dependencies; Rust alone guarantees no deadline.",
    "oreslang": "Not certified: a restricted, bounded-allocation native subset and RT kernel integration would require WCET/interrupt/scheduler verification.",
    "others": "C, C++, Ada/SPARK and RTOS toolchains are established in hard-RT domains; PREEMPT_RT helps but is not a universal guarantee.",
    "status": "research"
  },
  {
    "id": "aot-jit",
    "feature": "AOT vs JIT",
    "erlang": "BEAM bytecode is compiled ahead of running modules and OTP has a JIT in modern runtimes; not the same as producing standalone native programs.",
    "rust": "Usually AOT to native binaries via rustc/LLVM; no general-purpose production JIT in standard Rust.",
    "oreslang": "Target: LLVM native AOT, GraalVM JIT/Native Image and optional hybrid execution; feature equivalence must be established per backend.",
    "others": "Java/.NET normally mix IL/bytecode with JIT and support AOT paths; Go usually compiles AOT.",
    "status": "design"
  },
  {
    "id": "native-single-binaries",
    "feature": "Native code and standalone single binaries",
    "erlang": "Erlang modules execute on BEAM (with an OTP JIT on supported hosts). OTP releases can package an embedded runtime and dependencies, but standard deployment is not one self-contained machine-code executable.",
    "rust": "rustc normally emits native AOT executables and libraries; a single executable is often practical. Full portability or static linkage still depends on libc, target ABI, linked native libraries, assets and OS facilities.",
    "oreslang": "Target: LLVM native AOT executables and GraalVM Native Image distributions, optionally packaging application runtime into a single artifact. Fully static vs dynamic linking and platform dependencies vary; no verified one-file distribution across all targets is claimed.",
    "others": "Go often produces a single native executable; C/C++ depend on linker/toolchain settings; .NET Native AOT and GraalVM Native Image can ship native binaries; JVM apps commonly need a runtime or bundled distribution.",
    "status": "design"
  },
  {
    "id": "target-architectures",
    "feature": "Target architectures and portability",
    "erlang": "OTP commonly targets x86-64 and ARM/AArch64 on supported operating systems; other CPU/OS combinations require platform-specific runtime builds and testing. Cross-compiling BEAM/ERTS is not the same as universal target support.",
    "rust": "rustc offers tiered target support for x86/x86-64, ARM/AArch64, RISC-V, WebAssembly and other CPU/OS triples. Standard-library availability, atomics, toolchain distribution and cross-linking differ by target tier.",
    "oreslang": "Target matrix spans native LLVM architectures (x86-64, AArch64, ARM and RISC-V candidates), Java/GraalVM on its supported hosts, plus WebAssembly, JavaScript and .NET backend strategies. Architecture-level AOT, ABI, actor isolation and CI parity remain unverified for each target.",
    "others": "C/C++/LLVM and Zig have broad cross-compilation ecosystems; Go builds many CPU/OS pairs; Java and .NET target their respective supported VMs/runtimes. Availability must be checked for exact triples, not inferred from language names.",
    "status": "research"
  },
  {
    "id": "lambdas",
    "feature": "Usage in Lambdas / serverless",
    "erlang": "AWS Lambda can host Erlang/Elixir through custom runtimes or containers; BEAM startup and packaging remain factors.",
    "rust": "AWS Lambda supports Rust through custom runtimes/third-party tooling; native executables can benefit cold-start and memory budgets.",
    "oreslang": "Target: actor-backed functions in native/AOT builds and optional GraalVM modes; no verified AWS Lambda runtime, cold-start or cost advantage.",
    "others": "Go, Java, Node.js, Python and .NET have mature Lambda ecosystems; language closures are a separate concept.",
    "status": "research"
  },
  {
    "id": "mobile-phones",
    "feature": "Mobile phones (Android / iOS)",
    "erlang": "BEAM can be embedded in mobile applications using specialized integrations, but Android/iOS app delivery, platform policies, startup and footprint require substantial adaptation; not a standard mobile UI workflow.",
    "rust": "Android and iOS cross-compilation are supported targets. Rust is often used for reusable native libraries and application backends, paired with Kotlin/Swift or cross-platform UI tooling; mobile packaging and platform SDK integration remain necessary.",
    "oreslang": "Target: native/AOT isolated actor components for Android and iOS with platform FFI and lifecycle integration, respecting battery, background limits and iOS code-loading policies. No complete signed mobile app/SDK path is verified.",
    "others": "Kotlin/Java with Android, Swift/Objective-C with iOS, Flutter/Dart and React Native/JavaScript supply established mobile UI ecosystems.",
    "status": "research"
  },
  {
    "id": "desktop-apps",
    "feature": "Desktop applications",
    "erlang": "Erlang/OTP runs on desktop platforms and provides wx bindings; GUI packaging and native desktop UX are less central to its ecosystem than server/telecom workloads.",
    "rust": "Native binaries target Windows, macOS and Linux; Tauri, egui, iced and Slint support desktop app architectures. UI frameworks, code signing, packaging and auto-updates are ecosystem choices.",
    "oreslang": "Target: LLVM-native or GraalVM-backed app services with supervised background actors, native GUI/WebView bindings and package/sign/update workflows. No complete production desktop UI framework or installer is verified.",
    "others": "Electron (JS), .NET MAUI/WPF, Qt/C++, JavaFX and SwiftUI/AppKit offer established desktop application stacks.",
    "status": "research"
  },
  {
    "id": "actor-system",
    "feature": "Actor system",
    "erlang": "Native lightweight processes, mailbox receive, links, monitors and OTP supervisors; battle-tested semantics.",
    "rust": "Actors are typically crates/frameworks (Actix, Ractor, etc.), not core language primitives; Tokio tasks are not actors.",
    "oreslang": "Design: typed ActorRef messages, single-flight actor execution, shared/private/untrusted memory profiles and parent supervision; not all backends verified.",
    "others": "Elixir has OTP; Orleans/Akka provide virtual actors; Go favors goroutines and channels.",
    "status": "design"
  },
  {
    "id": "functional-programming",
    "feature": "Functional programming",
    "erlang": "Functional-first, immutable binding, closures, recursion, comprehensions, and higher-order functions; mutation is not idiomatic.",
    "rust": "First-class closures, iterators, traits, pattern matching and functional combinators alongside imperative mutation.",
    "oreslang": "Design: first-class functions, pure effects, map/filter/reduce, pattern matching and streams alongside actors and state loans.",
    "others": "Haskell/OCaml emphasize functional typing; JavaScript, Kotlin and C# mix functional and imperative styles.",
    "status": "design"
  },
  {
    "id": "adts",
    "feature": "Algebraic data types (ADTs)",
    "erlang": "Tagged tuples and pattern matching encode variants dynamically; records are tuple-based, not native Rust-style sum types.",
    "rust": "Enums with data-bearing variants, structs, Option/Result and exhaustive match form expressive static ADTs.",
    "oreslang": "Design: enums, tagged variants, tuples, structs and exhaustive match with ownership/sendability checks; public compiler proof pending.",
    "others": "Gleam/OCaml/Haskell have native sum types; TypeScript unions are erased at runtime.",
    "status": "design"
  },
  {
    "id": "data-oriented",
    "feature": "Data-oriented programming (DOP)",
    "erlang": "Erlang's immutable terms, binaries, ETS and batch-oriented message formats can represent collections, but BEAM does not natively expose explicit SoA/AoSoA memory layout or portable SIMD guarantees.",
    "rust": "Array/slice/struct layouts, iterators and explicit buffer ownership enable AoS, SoA, AoSoA and columnar data pipelines. Layout optimization is a programmer/library choice, not the default for every Rust collection.",
    "oreslang": "Design goal: typed AoS, SoA, AoSoA and SoAoS schemas, columnar buffers, bulk map/filter/reduce and actor-owned contiguous regions with checked borrowing. Layout lowering, SIMD parity and speedups require backend-specific executed evidence.",
    "others": "C/C++, Zig, Julia, Arrow and columnar database engines offer established data-parallel layout techniques; DOP refers to shaping programs around data transformations, not necessarily an ECS architecture.",
    "status": "research"
  },
  {
    "id": "data-oriented-design",
    "feature": "Data-oriented design (DoD) / ECS",
    "erlang": "Can organize systems around transformation stages, data batches and ETS tables, but OTP processes/supervisors are not intrinsically an ECS or a cache-local component storage engine.",
    "rust": "ECS libraries such as Bevy ECS and hecs allow entity IDs, compact components and systems running over matching component sets; storage layouts and contention patterns depend on each ECS implementation.",
    "oreslang": "Architecture target: design around access patterns, hot/cold fields, AoS/SoA/AoSoA chunks, archetype-style ECS queries and actor/task affinity. Keep mutable chunks actor-owned and forbid uncontrolled shared writes; no verified cache-miss or ECS throughput win.",
    "others": "Unity DOTS/Entities and C++ EnTT are established ECS and data-oriented design systems. DoD is an architectural method about locality and data flows, distinct from the language's DOP expressions and types.",
    "status": "research"
  },
  {
    "id": "gpus",
    "feature": "GPUs",
    "erlang": "Typically offload through NIFs, ports, drivers or external accelerator services; GPU code is not built into Erlang.",
    "rust": "GPU via crates/frameworks such as wgpu and CUDA bindings; safety depends on device API and kernel language.",
    "oreslang": "Research: GPU buffer/layout contracts and accelerator offload integrated with typed data and actors; no general production GPU backend verified.",
    "others": "Python has PyTorch/CUDA; C++ has CUDA/HIP; WebGPU is available across browser/native ecosystems.",
    "status": "research"
  },
  {
    "id": "distributed",
    "feature": "Distributed systems",
    "erlang": "Built-in distributed Erlang, process messaging, node connectivity, OTP clustering/supervision patterns.",
    "rust": "Networking/RPC/serialization typically assembled using crates; distributed actor systems exist as libraries.",
    "oreslang": "Goal: ProxyActor, typed remote messages, capabilities and supervised transports over IPC/TCP/HTTP; cross-node parity unverified.",
    "others": "Go has gRPC and cloud tooling; Java has Akka/cluster stacks; Elixir inherits BEAM distribution.",
    "status": "research"
  },
  {
    "id": "carrier-grade-linux",
    "feature": "Carrier-grade Linux",
    "erlang": "OTP has a long telecom deployment history, with supervision and distributed application patterns on Linux. Carrier Grade Linux concerns system availability and conformance; Erlang/OTP alone is not a CGL certification.",
    "rust": "Rust native services can run on HA Linux deployments and integrate with watchdogs, redundancy and RT scheduling. Safety and carrier-grade availability require system design, fault-injection and operations evidence.",
    "oreslang": "Target: supervised native Linux actors, graceful upgrade/rollback, failure isolation, bounded queues and diagnostics. No independent CGL compliance, carrier-grade availability target or telecom certification has been demonstrated.",
    "others": "C/C++, Java, Erlang and Go services can all participate in carrier-grade Linux deployments; hardware, kernel, redundancy, monitoring and operational qualification are system-level concerns.",
    "status": "research"
  },
  {
    "id": "embedded-systems",
    "feature": "Embedded systems",
    "erlang": "BEAM can run on capable embedded Linux/RTOS devices and purpose-built platforms such as GRiSP. Small microcontrollers with very limited RAM/flash generally cannot host a standard BEAM runtime.",
    "rust": "A mature embedded ecosystem targets Cortex-M and other MCUs through no_std, embedded-hal, target-specific crates and RTOS/firmware integration. Capability depends on target and board support.",
    "oreslang": "Research direction: freestanding LLVM/AOT language subset with static/arena allocation and explicit peripheral/C ABI bindings; full actor scheduler and networking need a suitable host. No validated microcontroller firmware target is claimed.",
    "others": "C/C++ and Ada/SPARK are established in embedded firmware; Zig and MicroPython cover different resource budgets.",
    "status": "research"
  },
  {
    "id": "fpga-asic",
    "feature": "FPGA and ASIC integration",
    "erlang": "Commonly orchestrates FPGA/ASIC-based devices through external services, ports or native drivers. BEAM application code does not ordinarily synthesize to RTL or gates.",
    "rust": "Can control FPGA/ASIC devices through MMIO, PCIe, drivers and C interfaces. Specialized HDL/HLS tools are needed to synthesize datapaths; ordinary Rust CPU binaries are not FPGA/ASIC logic.",
    "oreslang": "Long-term research: actor-supervised CPU control planes plus typed device buffers and explicit accelerator ABI. Synthesizable FPGA/ASIC RTL or HLS compilation is a separate unverified goal; LLVM native compilation alone does not generate circuits.",
    "others": "Verilog/SystemVerilog, VHDL and HDL/HLS systems such as Amaranth or vendor tools generate hardware; C/C++ can feed supported HLS workflows.",
    "status": "research"
  },
  {
    "id": "websockets",
    "feature": "WebSocket servers",
    "erlang": "Cowboy and other BEAM frameworks support large numbers of socket-driven connections with process isolation.",
    "rust": "Tokio-based stacks such as axum, tokio-tungstenite and Actix Web support high-concurrency WebSockets.",
    "oreslang": "Design: HTTP/WS actors with ownership-aware handoff, backpressure, quotas and supervisor-driven recovery; production capacity not verified.",
    "others": "Elixir Phoenix Channels, Node.js, Go and Java Netty provide established real-time servers.",
    "status": "design"
  },
  {
    "id": "rtc-signaling",
    "feature": "RTC signaling servers",
    "erlang": "Good fit for WebRTC signaling, presence and session routing over WebSocket; media plane often lives elsewhere.",
    "rust": "Good fit with async networking libraries for signaling, STUN/TURN integration and native protocol code; separate media plane is common.",
    "oreslang": "Target: actor sessions, identity-correlated WS streams, signaling state and typed control messages; no validated carrier-scale RTC signaling results.",
    "others": "Elixir/Phoenix, Node.js, Go and Java also operate WebRTC signaling; signaling is not media transcoding.",
    "status": "research"
  },
  {
    "id": "top-five",
    "feature": "Top 5 use cases",
    "erlang": [
      "Telecom switches and signaling control planes",
      "Always-on messaging and chat backends",
      "High-concurrency WebSocket/presence servers",
      "Supervised distributed job systems",
      "Fault-tolerant event ingestion"
    ],
    "rust": [
      "Native services and performance-sensitive APIs",
      "Embedded and edge agents",
      "Game/simulation engines",
      "Networking and developer tooling",
      "Data-processing and hardware interfaces"
    ],
    "oreslang": [
      "Proposed: native supervised telecom signaling",
      "Proposed: multi-tenant actor/FaaS runtimes",
      "Proposed: WebSocket and RTC signaling gateways",
      "Proposed: data-oriented CPU/GPU pipelines",
      "Proposed: low-latency isolated services"
    ],
    "others": [
      "Go: APIs and cloud infrastructure",
      "Elixir: real-time distributed apps",
      "Java: enterprise systems",
      "C++: engines and HPC",
      "Python: data science and ML"
    ],
    "status": "research"
  },
  {
    "id": "stack-traces",
    "feature": "Stack traces",
    "erlang": "Process crash reports, stacktraces, logger/SASL and OTP crash diagnostics integrate with supervisors.",
    "rust": "Backtraces through RUST_BACKTRACE, panic reporting, tracing spans and debugger/profiler integration.",
    "oreslang": "Goal: source-mapped async/actor stack traces with causal message context across AOT/Graal/native boundaries; no uniform verified format.",
    "others": "JVM/.NET offer mature stack diagnostics; distributed traces require correlation across services.",
    "status": "design"
  },
  {
    "id": "high-load-performance",
    "feature": "High load: CPU, memory and profiling",
    "erlang": "Observer, telemetry, tracing and profiling support scheduler utilization, reductions, mailbox growth and process memory analysis; capacity is workload-specific.",
    "rust": "perf, flamegraphs, tracing, heap profilers and runtime-specific instruments; tuning spans allocator, executor, batching and locking.",
    "oreslang": "Target: per-actor allocation/arena metrics, CPU profiles, p50/p95/p99 latency, queue depth, GC pauses and L1/L2 locality. No head-to-head throughput, memory or CPU win is established.",
    "others": "Go pprof, Java JFR and .NET counters support mature profiling; compare equal workloads on equal hardware.",
    "status": "research"
  },
  {
    "id": "concurrency-model",
    "feature": "Concurrency model",
    "erlang": "Preemptively scheduled BEAM processes communicate via mailboxes; isolated process heaps with no shared mutable Erlang terms by default.",
    "rust": "OS threads, atomics, scoped threads, async futures and channels; memory safety via Send/Sync and borrow checking.",
    "oreslang": "Design: single native-thread execution per actor at a time, multiple in-flight async messages, Tasks/channels/select and optional worker carriers; actor state via critical loans.",
    "others": "Go goroutines; Java virtual threads; C# async/await and thread pool; JS event loop/workers.",
    "status": "design"
  },
  {
    "id": "nonblocking-io",
    "feature": "Non-blocking I/O by default",
    "erlang": "BEAM socket/network I/O integrates with the runtime so Erlang processes can wait without blocking a normal scheduler thread. Blocking NIFs and drivers require dirty schedulers or separate workers; not every foreign call is non-blocking.",
    "rust": "std file/socket APIs are often blocking unless configured otherwise. Non-blocking I/O and async execution are explicit choices through Tokio, async-std, mio or OS interfaces; async syntax does not make arbitrary FFI non-blocking.",
    "oreslang": "Design direction: default evented, backpressured I/O for actor HTTP/TCP/WebSocket and channel operations; blocking foreign calls need isolation or dedicated blocking pools. No universal non-blocking default or cross-backend implementation is verified.",
    "others": "Node.js has an event-loop-centric I/O model but synchronous APIs exist; Go uses a netpoller with goroutines; Java has NIO and virtual threads; .NET supports async I/O.",
    "status": "design"
  },
  {
    "id": "ffi-abi",
    "feature": "FFI, ABI and C integration",
    "erlang": "C NIFs and ports/driver interfaces; NIF mistakes can block schedulers or crash the VM.",
    "rust": "Stable C ABI interoperability via extern C and #[repr(C)]; Rust ABI itself is not generally stable across versions.",
    "oreslang": "Goal: explicit C-facing ABI/FFI and safe ownership boundaries, backend-specific native addons and guarded untrusted capabilities; ABI stability not verified.",
    "others": "Node.js N-API supports native addons; C++ ABI varies; JVM JNI/FFM and .NET P/Invoke bridge native code.",
    "status": "research"
  },
  {
    "id": "packages-modules",
    "feature": "Package managers and module systems",
    "erlang": "OTP applications and modules; Hex/rebar3 for Erlang ecosystem, Mix for Elixir.",
    "rust": "Cargo/crates.io/workspaces, explicit modules and visibility, features and lockfiles.",
    "oreslang": "Goal: package manifests, reproducible dependency resolution, lexical modules/visibility and backend artifacts; ecosystem/tooling under development.",
    "others": "Go modules, npm, Maven/Gradle, NuGet, opam and CMake/vcpkg cover different tradeoffs.",
    "status": "research"
  }
];

export const matrixReferences = [
  {
    "label": "Erlang/OTP release handling",
    "url": "https://www.erlang.org/doc/system/release_handling.html"
  },
  {
    "label": "Erlang code loading",
    "url": "https://www.erlang.org/docs/25/reference_manual/code_loading.html"
  },
  {
    "label": "Erlang distributed applications",
    "url": "https://www.erlang.org/doc/system/distributed_applications.html"
  },
  {
    "label": "Erlang NIF safety",
    "url": "https://www.erlang.org/doc/apps/erts/erl_nif.html"
  },
  {
    "label": "Erlang/OTP manuals",
    "url": "https://www.erlang.org/docs"
  },
  {
    "label": "Rust language book",
    "url": "https://doc.rust-lang.org/book/"
  },
  {
    "label": "Rust Cargo manual",
    "url": "https://doc.rust-lang.org/cargo/"
  },
  {
    "label": "Rust reference: external blocks",
    "url": "https://doc.rust-lang.org/reference/items/external-blocks.html"
  },
  {
    "label": "Tokio",
    "url": "https://tokio.rs/"
  },
  {
    "label": "Linux PREEMPT_RT kernel notes",
    "url": "https://docs.kernel.org/core-api/real-time/differences.html"
  },
  {
    "label": "AttoLang public draft and verification status",
    "url": "/language/"
  },
  {
    "label": "AttoLang measured performance evidence",
    "url": "/performance/"
  }
];
