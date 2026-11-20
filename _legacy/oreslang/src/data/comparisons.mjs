/** Editorial comparisons: AttoLang architectural direction, not measured performance results. */
export const comparisons = [
  {
    "id": "elixir",
    "name": "Elixir",
    "headline": "OTP's fault tolerance, with native ambitions and compile-time contracts.",
    "strength": "Elixir and Phoenix are excellent choices for web services, real-time systems, concurrent I/O, distributed messaging and operationally mature OTP supervision. Elixir's ergonomic syntax, immutable values, battle-tested BEAM scheduler and release tooling are genuine strengths—not problems AttoLang has already solved better.",
    "angles": [
      {
        "topic": "Type guarantees at actor boundaries",
        "peer": "Elixir is dynamically typed, supports specs and Dialyzer, and is evolving stronger static checking. Messages are idiomatically pattern matched, but ordinary mailboxes do not impose Rust-style ownership or static, end-to-end payload contracts.",
        "oreslang": "AttoLang aims for compile-time types, Option-safe values, checked ownership and typed ActorRef messages. The send boundary should establish who can read, mutate or transfer an object—not merely whether a message has the expected shape.",
        "impact": "As a codebase gains teams and services, message schemas become a compiler-enforced contract instead of scattered conventions."
      },
      {
        "topic": "FaaS, mobile and cold starts",
        "peer": "BEAM boots a VM and application release; operational tuning and warm instances can make this practical, but the runtime remains part of deployment. Elixir is not primarily optimized for tiny short-lived native processes.",
        "oreslang": "An AOT-first LLVM/native route targets startup-sensitive processes without booting the BEAM or a general JIT. GraalVM-backed AttoLang is a separate runtime profile and should not be confused with an LLVM native build.",
        "impact": "The interesting opportunity is to apply actor isolation to short-lived functions and mobile background tasks, not just always-on servers. Actual cold-start wins need matched tests."
      },
      {
        "topic": "Heavy CPU, GPU and data layout",
        "peer": "Elixir excels at orchestration and I/O. CPU-intensive kernels can run through NIFs, dirty schedulers, ports and native libraries, but each boundary adds a separate engineering surface.",
        "oreslang": "The LLVM plan brings native code generation, explicit ownership and data-oriented layouts under the language. Actors coordinate and supervise work; contiguous data and Tasks, not one actor per element, provide the hot compute path.",
        "impact": "One codebase could express both the fault-tolerant pipeline and its performance-sensitive kernel, with fewer duplicated ownership models."
      },
      {
        "topic": "Fault recovery and upgrades",
        "peer": "OTP supervisors, links, monitors and release upgrades are real production technology. Elixir inherits this advantage from Erlang and has strong deployment practices.",
        "oreslang": "AttoLang proposes typed supervision, actor lifecycle hooks, bounded mailboxes and versioned hot loading with staged activation and rollback. Isolation should extend to state and capability scopes, not only a logical process identifier.",
        "impact": "Aim to preserve the 'let it crash' operational style while making the conditions for safe recovery and code replacement more explicit."
      },
      {
        "topic": "Mutable memory and tenant boundaries",
        "peer": "BEAM processes isolate heaps and share immutable data efficiently, with per-process GC. A NIF runs outside the ordinary managed safety guarantees and needs great care.",
        "oreslang": "Actor-owned mutable arenas, authorized immutable sharing and compiler-checked borrows aim to confine state even in native-code paths. The LLVM zero-GC profile is a target; managed/GraalVM profiles may still collect.",
        "impact": "The promise is isolation without insisting that every trusted computation become a separate OS process or V8 isolate."
      }
    ],
    "boundary": "Choose Elixir now for production Phoenix, distributed OTP operations and proven live upgrades. Choose the AttoLang direction when static ownership plus native performance plus fault isolation must feel like one coherent language; no comparable production or cold-start win has been verified.",
    "sources": [
      {
        "label": "Elixir language and ecosystem",
        "url": "https://elixir-lang.org/"
      },
      {
        "label": "Erlang release and live code handling",
        "url": "https://www.erlang.org/doc/system/release_handling.html"
      },
      {
        "label": "BEAM native interoperability",
        "url": "https://www.erlang.org/doc/apps/erts/erl_nif.html"
      }
    ],
    "thesis": "Elixir showed developers how productive the actor model can be. AttoLang's wager is that you should not have to choose between that model and Rust-like static ownership, native AOT deployment, and compute-heavy work. The goal is a single language where your service's fast path and its resilient control plane live under the same safety rules.",
    "benefits": [
      {
        "title": "Compile-time message contracts",
        "detail": "Make the shape of messages, ownership transfers and absence explicit before a request enters a mailbox, rather than depending predominantly on runtime conventions."
      },
      {
        "title": "AOT-shaped deployment",
        "detail": "Target smaller native execution envelopes for short-lived jobs, on-device agents and FaaS handlers while keeping the actor model. Startup and memory gains remain to be benchmarked."
      },
      {
        "title": "Compute without a language handoff",
        "detail": "Design actor coordination and native numerical work to coexist through LLVM, instead of treating CPU/GPU kernels as an inherently foreign-language subsystem."
      }
    ],
    "useCases": [
      {
        "title": "Cold-start-sensitive actor services",
        "detail": "Bursty API/FaaS handlers and mobile background workers that want typed mailboxes and inexpensive native processes."
      },
      {
        "title": "Compute-heavy real-time pipelines",
        "detail": "Audio, sensor, ML pre/post-processing and simulation services requiring resilient orchestration around native data processing."
      }
    ]
  },
  {
    "id": "erlang",
    "name": "Erlang",
    "headline": "Keep Erlang's 'let it crash' resilience. Add ownership and native reach.",
    "strength": "Erlang/OTP has decades of production experience in telecom, messaging and high-availability infrastructure. Lightweight processes, pattern matching, supervisors, hot code upgrades and per-process GC are exceptionally thoughtful engineering.",
    "angles": [
      {
        "topic": "Dynamic messages versus checked protocols",
        "peer": "Erlang matches message patterns dynamically. Records, specs and Dialyzer improve confidence, yet arbitrary mailbox messages can still surprise a receiver at runtime.",
        "oreslang": "Typed ActorRef messages, Option/Result handling and ownership constraints are designed to catch protocol and lifetime errors earlier. The actor mailbox should remain isolated and linearizable as implementations mature.",
        "impact": "Protocol drift becomes a compiler or schema problem rather than a production mailbox surprise."
      },
      {
        "topic": "Where CPU cycles are spent",
        "peer": "The BEAM scheduler excels at many independent small processes; long CPU-bound native work is normally moved into dirty NIF schedulers or other native integrations.",
        "oreslang": "An LLVM compilation path targets CPU-intensive loops, tightly packed data, SIMD-friendly storage and future device kernels while keeping actors for supervision and coordination.",
        "impact": "The design avoids forcing teams to choose a second language whenever control-plane code meets a hot numerical loop."
      },
      {
        "topic": "Memory lifetime and collection",
        "peer": "Per-process heaps make Erlang GC much less disruptive than a monolithic collector, but memory is still GC-managed in the usual BEAM execution model.",
        "oreslang": "AttoLang combines actor-local mutable arenas, borrow checking and explicit sharing domains. A strict LLVM profile targets no runtime tracing GC, while a GraalVM profile can retain managed collection.",
        "impact": "For systems with tight allocation and latency budgets, lifecycle control could be as explicit as mailbox ownership."
      },
      {
        "topic": "Supervision and live evolution",
        "peer": "Erlang/OTP supplies mature linking, monitors, supervisors and code replacement. The ecosystem has refined restart strategies over decades.",
        "oreslang": "AttoLang's plan adds typed lifecycle contracts, staged versioned reload, ability to roll back, and explicit trust/capability limits. Failures should route to supervisors rather than corrupt peers' state.",
        "impact": "The objective is to retain OTP-style recoverability while making upgrades and permissions more auditable."
      },
      {
        "topic": "Beyond a conventional OS host",
        "peer": "Erlang is a BEAM runtime language and is most at home on devices that can host that runtime.",
        "oreslang": "AttoLang separates freestanding core, optional allocation/runtime services and stdlib/OTP analogues. Bare-metal and specialized accelerator targets are longer-term subsets, not a claim that complete actors already run on an FPGA.",
        "impact": "A small kernel and a supervised cloud service could eventually share a language vocabulary without sharing one heavyweight deployment model."
      }
    ],
    "boundary": "Use Erlang when battle-tested distributed operations and OTP compatibility dominate the decision. AttoLang is making an architectural bet on typed, native, memory-safe actors; matching Erlang's reliability will require substantial conformance and operational evidence.",
    "sources": [
      {
        "label": "Erlang/OTP documentation",
        "url": "https://www.erlang.org/docs"
      },
      {
        "label": "Erlang native and dirty schedulers",
        "url": "https://www.erlang.org/doc/apps/erts/erl_nif.html"
      },
      {
        "label": "Erlang release management",
        "url": "https://www.erlang.org/doc/system/release_handling.html"
      }
    ],
    "thesis": "Erlang proved that concurrent systems become manageable when failure is isolated and supervised. AttoLang treats that achievement as the starting point, not the finish line: it is designing an actor system with static message contracts, borrow-aware native memory and a runtime that is not confined to the BEAM.",
    "benefits": [
      {
        "title": "Isolation you can type-check",
        "detail": "Make actor communication and ownership transfer explicit and verifiable before deployment, not solely through runtime discipline."
      },
      {
        "title": "Native code as a first-class target",
        "detail": "Let the same language target native CPU-intensive logic and actor supervision with predictable ownership contracts."
      },
      {
        "title": "One model, many execution profiles",
        "detail": "Aim for full actor runtimes where available and a freestanding core for hardware-constrained environments."
      }
    ],
    "useCases": [
      {
        "title": "Native telecom and edge workloads",
        "detail": "Real-time protocol handlers near DSP/signal-processing kernels, with supervision kept near the fast path."
      },
      {
        "title": "Multi-tenant native services",
        "detail": "Independent, restartable workloads needing typed messages and per-tenant memory/capability boundaries."
      }
    ]
  },
  {
    "id": "gleam",
    "name": "Gleam",
    "headline": "Gleam brings types to the BEAM. AttoLang brings actors toward native hardware.",
    "strength": "Gleam has a clean statically typed syntax, strong inference and approachable functional programming, with official Erlang and JavaScript targets. It gains practical reach through both BEAM packages and JavaScript ecosystems.",
    "angles": [
      {
        "topic": "How far the type system reaches",
        "peer": "Gleam provides static inference, algebraic data types and pattern matching. It does not attempt to be a Rust-style borrow-checked memory-ownership language.",
        "oreslang": "AttoLang pairs static nominal/structural types with borrow and ownership semantics. Actors own mutable memory; moving or sharing values across boundaries should require a checkable capability.",
        "impact": "Types describe not only what data is, but who can safely touch it and for how long."
      },
      {
        "topic": "Runtime targets",
        "peer": "Gleam targets both Erlang/BEAM and JavaScript. That is real portability, but it inherits the runtime and FFI characteristics of whichever host is chosen.",
        "oreslang": "AttoLang targets GraalVM and LLVM with an explicit distinction between managed and native profiles; future Wasm, freestanding and accelerator integrations must be individually validated.",
        "impact": "One language aims to span native compute, actor-based services and constrained environments, rather than only portable source code."
      },
      {
        "topic": "CPU/GPU-intensive work",
        "peer": "Gleam on BEAM delegates intensive numerical work through NIFs, ports or packages; its JavaScript target can use workers/native addons and accelerator APIs.",
        "oreslang": "AttoLang's native plan favors contiguous data-oriented layouts and kernel-friendly ownership within an actor-controlled workload. Actors supervise batches; Tasks execute parallel work.",
        "impact": "The core computation and the message-driven control plane could be optimized as parts of the same language."
      },
      {
        "topic": "Concurrency semantics",
        "peer": "Gleam can use OTP actors on its Erlang target; different concurrency tools apply on JavaScript. Its type system does not provide one universal native actor scheduler across hosts.",
        "oreslang": "A consistent Task versus Actor distinction is a primary goal: Tasks for lightweight computations and actors for owned state, mailbox ordering, faults and hot replacement.",
        "impact": "The developer chooses isolation intentionally, without turning every concurrent function into a heavyweight process."
      },
      {
        "topic": "Failure containment and lifecycle",
        "peer": "Gleam benefits from BEAM supervision libraries, but executable capabilities and reload mechanisms depend on the selected backend and runtime integration.",
        "oreslang": "The AttoLang runtime design makes supervision, capability confinement, message admission and versioned code replacement part of the same contract across implementations.",
        "impact": "An actor becomes a unit of recovery, authority and code evolution—not just a convenient way to send messages."
      }
    ],
    "boundary": "Choose Gleam now for a polished typed functional experience and access to BEAM or JavaScript ecosystems. AttoLang's pitch is stronger ownership and broader native systems ambitions, not the false claim that Gleam only compiles to Erlang.",
    "sources": [
      {
        "label": "Gleam documentation and targets",
        "url": "https://gleam.run/documentation/"
      },
      {
        "label": "Gleam language tour",
        "url": "https://tour.gleam.run/"
      },
      {
        "label": "Erlang NIF reference",
        "url": "https://www.erlang.org/doc/apps/erts/erl_nif.html"
      }
    ],
    "thesis": "Gleam is an excellent answer to 'what if Erlang/Elixir had a modern static type system?' AttoLang asks a larger systems question: what if actor supervision, a borrow checker, native compilation and explicit memory domains were designed together rather than added around the BEAM?",
    "benefits": [
      {
        "title": "Types plus ownership",
        "detail": "Go beyond checking values: reason about exclusive mutation, borrowing, transfer and private actor state."
      },
      {
        "title": "A different performance envelope",
        "detail": "Design LLVM-native and zero-GC profiles for hot compute loops without relying on FFI-heavy BEAM deployments."
      },
      {
        "title": "A deeper actor runtime contract",
        "detail": "Make supervision, Task cancellation, typed mailboxes and reload semantics core design constraints."
      }
    ],
    "useCases": [
      {
        "title": "Typed services with native hot paths",
        "detail": "Message-driven services that also include codecs, numerical transformations or local AI computations."
      },
      {
        "title": "Systems that outgrow BEAM-only execution",
        "detail": "Applications needing an actor-style architecture but deployment on native or eventually freestanding targets."
      }
    ]
  },
  {
    "id": "rust",
    "name": "Rust",
    "headline": "Rust protects memory. AttoLang wants to protect the entire running system.",
    "strength": "Rust is already excellent for native systems: ownership, borrowing, Send/Sync, no_std, async/await, Tokio tasks, production actor libraries, low-level memory control and outstanding LLVM tooling. The distinction is not that Rust lacks Tasks or actors; it is where those semantics are defined.",
    "angles": [
      {
        "topic": "Tasks are real in Rust—what changes?",
        "peer": "Rust has async/await and Tokio's very lightweight tasks with JoinHandle, cancellation semantics and sophisticated work stealing. It also has async-std, smol, threads and scoped parallelism.",
        "oreslang": "AttoLang's nb Task syntax and scheduler are part of the intended language experience, with do nb fire-and-continue, awaitable Task<T> handles and explicit cancellation boundaries. Ordinary code need not run inside an actor.",
        "impact": "Developers can express fast concurrency without committing to a particular executor crate or pretending a Task and an actor have identical isolation rules."
      },
      {
        "topic": "Actor isolation versus library discipline",
        "peer": "Rust libraries implement actors, mailboxes and supervisors, often with type-safe channels. They can be excellent, but the exact state and lifecycle contract varies by crate.",
        "oreslang": "AttoLang aims to make an ActorRef<T> send boundary, actor-owned mutable arena, mailbox order and supervisor escalation consistent across runtime backends. Cross-actor mutation should be restricted by the language's ownership rules.",
        "impact": "Concurrency architecture becomes a checkable part of the application contract, not a choice repeated across libraries."
      },
      {
        "topic": "Send/Sync and zero-copy sharing",
        "peer": "Rust's Send/Sync auto traits, lifetimes, Arc, Mutex and borrowing offer powerful and proven shared-memory safety, including high-performance ECS and data-oriented systems.",
        "oreslang": "AttoLang adopts similar sendability and safe borrow concepts, while distinguishing private actor mutation from authorized immutable zero-copy sharing and field-sensitive region borrows.",
        "impact": "Large native workloads could combine cache-friendly, columnar data with supervised actors—without an actor per row or an unnecessary memcpy."
      },
      {
        "topic": "Faults, supervision and live upgrades",
        "peer": "Rust can detect panics and implement supervisors, but OTP-style restart trees and hot code swaps are not uniform built-in language facilities. Stable live replacement often needs custom indirection, ABI and state migration plans.",
        "oreslang": "AttoLang targets structured throw/raise/panic propagation to supervisors, explicit actor lifecycle, stable message contracts and generation-aware staged hot reload with rollback.",
        "impact": "A system can update a worker without treating every failure and code migration as a bespoke infrastructure project."
      },
      {
        "topic": "Bare metal and heterogeneous compute",
        "peer": "Rust already has robust no_std support and credible embedded, native, SIMD and GPU ecosystems; it often wins immediately on tooling maturity.",
        "oreslang": "AttoLang plans a freestanding core, optional alloc and stdlib split plus LLVM-native/no-GC profiles, with accelerator-oriented regions and kernels as future work.",
        "impact": "The long-term bet is a single systems-language vocabulary from edge compute to resilient services—not a claim that AttoLang already matches Rust's embedded ecosystem."
      }
    ],
    "boundary": "Rust is the production choice today for safe native performance, embedded hardware and ecosystem depth. AttoLang's proposed advantage is integrating ownership, actors, Tasks and hot reload into one coherent runtime contract; the overhead and reliability still require proof.",
    "sources": [
      {
        "label": "Rust ownership and borrowing",
        "url": "https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html"
      },
      {
        "label": "Tokio task spawning",
        "url": "https://tokio.rs/tokio/tutorial/spawning"
      },
      {
        "label": "Rust Send and Sync",
        "url": "https://doc.rust-lang.org/nomicon/send-and-sync.html"
      },
      {
        "label": "Actix actor framework",
        "url": "https://actix.rs/docs/actix/"
      }
    ],
    "thesis": "Rust made ownership a practical language-level guarantee. AttoLang takes that philosophy into a larger concurrency contract: native safety, lightweight Tasks, isolated actors, supervised failure and swappable code, designed as cooperating parts instead of a stack of independent libraries. Think 'Rust-like discipline meets Erlang-like recovery.'",
    "benefits": [
      {
        "title": "Actor model built in",
        "detail": "Typed mailboxes, actor-owned mutable heaps, supervision and lifecycle contracts aim to be language/runtime invariants rather than framework conventions."
      },
      {
        "title": "Tasks for work, actors for isolation",
        "detail": "Use lightweight nb Tasks for parallel I/O or compute and actors only where state protection, supervision or messaging truly matter."
      },
      {
        "title": "Hot code with a safety story",
        "detail": "Versioned code loading and staged rollback aim to work alongside ownership and actor state, rather than bolted-on dynamic libraries."
      }
    ],
    "useCases": [
      {
        "title": "Plugin or tenant execution hosts",
        "detail": "Servers that need typed native extensions, revocable capabilities, per-actor state and controlled code replacement."
      },
      {
        "title": "Real-time or simulation backends",
        "detail": "Cache-local data-oriented compute under an actor-supervised orchestration layer, with Tasks for fine-grained parallel work."
      }
    ]
  },
  {
    "id": "java",
    "name": "Java",
    "headline": "Virtual threads make waiting cheaper. Actors make shared state less dangerous.",
    "strength": "The JVM has world-class JITs, debugging, profilers, production libraries, virtual threads, structured concurrency libraries and advanced collectors. GraalVM Native Image can also build fast-starting native executables. AttoLang should earn its place through clearer isolation, not dismiss Java's engineering quality.",
    "angles": [
      {
        "topic": "Virtual threads versus Tasks and actors",
        "peer": "Java virtual threads make high-concurrency blocking-style I/O easier, but they do not stop two threads from mutating the same object. Locks, immutable design and disciplined libraries still matter.",
        "oreslang": "AttoLang separates lightweight schedulable Tasks from actors that own mutable state. A mailbox and sealed callbacks define where mutation happens; typed messages express interactions.",
        "impact": "Thread scaling and data-race prevention become distinct, explicit engineering concerns instead of being conflated."
      },
      {
        "topic": "The actor model: framework or language?",
        "peer": "Akka/Pekko, Orleans-like patterns in other runtimes, and Java libraries offer message-driven services; Scala on the JVM has had advanced actor frameworks. Their safety guarantees depend on APIs and discipline.",
        "oreslang": "AttoLang proposes built-in ActorRef<T>, supervision, actor arenas and lifecycle hooks across more than one execution backend. The actor is intended to be a runtime-owned isolation boundary, not merely a class with a queue.",
        "impact": "Teams can reason about failure containment and state visibility before choosing a service framework."
      },
      {
        "topic": "Memory collection and tail latency",
        "peer": "HotSpot offers G1, ZGC and Shenandoah with sophisticated low-pause options. GraalVM Native Image also has its own memory strategies; blanket claims of long JVM pauses are misleading.",
        "oreslang": "AttoLang's managed/GraalVM profile may use GC; the strict LLVM profile targets explicit native ownership and zero runtime GC for supported programs.",
        "impact": "A service can aim to select its memory tradeoff at compilation/deployment time, while testing actual p99 latency instead of assuming zero-GC guarantees speed."
      },
      {
        "topic": "Cold starts and footprint",
        "peer": "The JVM's class loading, JIT warmup and runtime footprint matter in some FaaS and device scenarios. GraalVM Native Image already mitigates many startup concerns for Java.",
        "oreslang": "AttoLang aims at AOT native builds for bursty jobs, while keeping a separate JIT-capable profile for dynamic workloads. Actor semantics are meant to remain recognizable across both.",
        "impact": "The value is combining native deployment with actor-oriented supervision—not pretending Java cannot compile AOT."
      },
      {
        "topic": "Hot code, trust and failure routing",
        "peer": "Class loaders, agents and module systems allow sophisticated deployment strategies; production-safe state migration and plugin isolation still require careful integration.",
        "oreslang": "AttoLang designs actor generations, staged reload, failure escalation and capabilities as an explicit lifecycle protocol, with different trust classes and controlled sharing.",
        "impact": "Reloading a worker becomes a supervised state transition rather than an ad hoc classloader replacement."
      }
    ],
    "boundary": "Java remains a superb production ecosystem, and modern collectors and virtual threads are significant advances. AttoLang is promising a more principled actor/ownership model and optional native zero-GC execution, not a universal speed or latency victory.",
    "sources": [
      {
        "label": "JEP 444 — Virtual Threads",
        "url": "https://openjdk.org/jeps/444"
      },
      {
        "label": "JVM Garbage Collector ZGC",
        "url": "https://docs.oracle.com/en/java/javase/25/gctuning/z-garbage-collector.html"
      },
      {
        "label": "GraalVM Native Image",
        "url": "https://www.graalvm.org/latest/reference-manual/native-image/"
      }
    ],
    "thesis": "Java excels at enterprise scale, but concurrency safety remains largely a convention layered over shared objects, synchronization and framework choices. AttoLang's argument is stronger: let lightweight Tasks handle execution while actors own state, enforce typed messages and supervise failure. Then choose a managed GraalVM path or a native LLVM path according to deployment needs.",
    "benefits": [
      {
        "title": "Ownership at the right boundary",
        "detail": "A private actor heap and typed message contract aim to eliminate broad categories of accidental shared-state races."
      },
      {
        "title": "Not bound to one VM",
        "detail": "GraalVM and LLVM are separate intended compilation profiles, allowing managed JIT and native no-GC design tradeoffs."
      },
      {
        "title": "Lifecycle is part of the model",
        "detail": "Supervision and versioned actor upgrades are designed as runtime semantics, not just library deployment patterns."
      }
    ],
    "useCases": [
      {
        "title": "Latency-conscious multitenant services",
        "detail": "Native actors with isolated state and bounded mailboxes, without a separate JVM process for every tenant."
      },
      {
        "title": "Extensible infrastructure services",
        "detail": "Long-running plugin workers needing versioned reload, capabilities and native or managed deployment options."
      }
    ]
  },
  {
    "id": "cpp",
    "name": "C++",
    "headline": "C++ gives you control. AttoLang aims to make the safe path the default.",
    "strength": "C++ remains foundational in engines, finance, robotics, embedded systems, compilers and GPU computing. RAII, move semantics, templates, coroutines, smart pointers and modern sanitizers are powerful—and no required garbage collector is already normal.",
    "angles": [
      {
        "topic": "RAII versus enforced borrowing",
        "peer": "RAII and smart pointers provide deterministic resource management, but C++ still permits raw pointers, invalid aliasing, use-after-free and subtle data races in ordinary code.",
        "oreslang": "AttoLang proposes compiler-checked ownership/borrows, actor-owned mutable arenas and explicit unsafe/foreign interfaces where unavoidable.",
        "impact": "The intended default is that moving data across a boundary must obey lifetime and sharing rules rather than trusting every call site."
      },
      {
        "topic": "Threads, coroutines and scheduling",
        "peer": "C++20 coroutines are a flexible mechanism, not a single baked-in scheduler; production task runtimes and actor patterns vary by application/library.",
        "oreslang": "The AttoLang runtime proposes lightweight M:N Tasks with await/select, plus actors with mailboxes and supervision. Ordinary CPU loops can run without becoming actors.",
        "impact": "Applications get a clearer standard way to describe execution versus isolation, without writing a bespoke scheduling framework each time."
      },
      {
        "topic": "Fault containment",
        "peer": "A segmentation fault or memory corruption in native C++ can terminate or poison the process. Library-level actors cannot completely sandbox arbitrary unsafe native code.",
        "oreslang": "Borrow-checked native code and actor-owned mutable state target fewer accidental corruption pathways. Supervisors can manage language-level failures; untrusted native code still needs a real security boundary.",
        "impact": "Supervision is more meaningful when the language narrows the ways one component can corrupt another."
      },
      {
        "topic": "Hot swapping running components",
        "peer": "Dynamic libraries and plugins can be reloaded, but ABI stability, object layout, in-flight calls and state migration are often custom engineering work.",
        "oreslang": "Versioned actor contracts, staged code generation and controlled rollback are central hot-reload design goals, with explicit state and capability migration.",
        "impact": "Treat safe code replacement as a repeatable application operation, not an undocumented set of pointer assumptions."
      },
      {
        "topic": "Bare metal, SIMD, GPU and cache locality",
        "peer": "C++ already supports outstanding bare-metal, native, SIMD and accelerator toolchains. Its dominance in HPC and specialized devices is not in question.",
        "oreslang": "AttoLang targets LLVM-native/no-GC execution, a freestanding core and cache-friendly AoS/SoA/AoSoA layouts. FPGA/ASIC and GPU profiles remain aspirational and require real kernels.",
        "impact": "The value proposition is native performance plus constrained concurrency, not a promise to beat mature C++ toolchains on every platform."
      }
    ],
    "boundary": "Choose C++ today for demanding specialized hardware, ABI compatibility and established HPC tooling. AttoLang's opportunity is eliminating routine safety and lifecycle glue while retaining a native performance envelope; current benchmarks do not establish parity.",
    "sources": [
      {
        "label": "C++ coroutines",
        "url": "https://en.cppreference.com/w/cpp/language/coroutines"
      },
      {
        "label": "C++ RAII and lifetime",
        "url": "https://en.cppreference.com/w/cpp/language/raii"
      },
      {
        "label": "LLVM project",
        "url": "https://llvm.org/"
      }
    ],
    "thesis": "C++ can extract exceptional performance from nearly any machine, but its freedom makes ownership, aliasing, concurrency and hot reload a continuing code-review burden. AttoLang is aiming for the same native ambition with borrow-checked state, typed actor communication and a supervised runtime model that helps a system stay alive when components fail.",
    "benefits": [
      {
        "title": "Safer memory as a language invariant",
        "detail": "Reject dangerous borrows and unauthorized mutable sharing before they become dangling pointers or cross-thread races."
      },
      {
        "title": "Real supervision for native code",
        "detail": "Actors package state, mailbox contracts, failure routing and managed lifecycle around high-performance components."
      },
      {
        "title": "Compute-friendly without actor overhead everywhere",
        "detail": "Use direct data-oriented loops, contiguous buffers and Tasks for fine-grained work; deploy actors where isolation earns its cost."
      }
    ],
    "useCases": [
      {
        "title": "Long-lived native plugin systems",
        "detail": "Reliably swapping independently supervised native worker modules without loose lifetime assumptions."
      },
      {
        "title": "Data-heavy simulation and control",
        "detail": "Zero-GC-oriented data layouts and Tasks, with actor supervision at coarse-grained boundaries."
      }
    ]
  },
  {
    "id": "golang",
    "name": "Go",
    "headline": "Go made concurrency simple. AttoLang aims to make concurrency safe by construction.",
    "strength": "Go already compiles to native binaries, starts quickly, has a powerful M:N goroutine scheduler, simple channels, an excellent standard library and a famously straightforward deployment model. Its concurrent GC has improved continuously. AttoLang cannot claim Go lacks parallelism or AOT compilation.",
    "angles": [
      {
        "topic": "Share memory by communicating—for real",
        "peer": "Go encourages channels and ownership handoffs, but its type system permits shared mutable pointers and requires mutexes, atomic operations or disciplined channel ownership to avoid races.",
        "oreslang": "AttoLang intends actor-owned mutable state, borrow checking and typed ActorRef messages to make implicit cross-actor mutable sharing unavailable by default.",
        "impact": "A concurrency policy can become a compiler-enforced boundary rather than a team convention backed primarily by the race detector."
      },
      {
        "topic": "Goroutines versus Tasks plus actors",
        "peer": "Go goroutines are lightweight and genuinely run in parallel via the Go scheduler. Channels, select and context cancellation are mature primitives; Go doesn't use async/await syntax.",
        "oreslang": "AttoLang proposes nb Tasks for lightweight parallel/suspending work, await/select syntax and actors for private state, message order, failures and supervision. A Task should not need a whole actor or OS thread.",
        "impact": "Choose the smallest primitive for each problem: tasks for work, actors for isolation and recovery."
      },
      {
        "topic": "GC and tail latency",
        "peer": "Go uses a concurrent, low-latency tracing GC that still consumes CPU and can briefly stop the world. Its actual pause behavior is typically good and tuning matters.",
        "oreslang": "AttoLang's LLVM strict profile targets zero runtime GC with explicit arenas, borrowing and deterministic release; GraalVM modes may still have managed collection.",
        "impact": "For tight latency budgets, predictability could improve by design—but only benchmarked p99 and p99.9 behavior can settle the tradeoff."
      },
      {
        "topic": "Worker supervision and hot reload",
        "peer": "Go services typically implement restart loops, orchestration, message schemas and rolling deploys with libraries and infrastructure. Hot-swapping a live function's code and actor state is not a language-level feature.",
        "oreslang": "AttoLang targets supervisor-directed recovery, versioned actor generation, typed mailboxes and staged hot reload with rollback.",
        "impact": "Long-lived session and plugin hosts could update small stateful components without always recycling the entire process."
      },
      {
        "topic": "Beyond standard server binaries",
        "peer": "Go has excellent compiled Linux/macOS/Windows deployment and has specialized TinyGo toolchains for embedded/Wasm targets; typical Go still relies on its runtime and GC.",
        "oreslang": "AttoLang separates freestanding core, optional allocation and richer actor/stdlib profiles; future LLVM GPU, FPGA and ASIC subsets are research/development targets, not shipped parity.",
        "impact": "The long-term aim is shared language semantics across native services and constrained compute targets."
      }
    ],
    "boundary": "Go remains the safer operational bet for many APIs, agents and infrastructure teams. AttoLang's strongest argument is making Go's communication-first philosophy enforceable while integrating supervision, ownership and optional no-GC native execution; those gains remain design goals.",
    "sources": [
      {
        "label": "Effective Go — concurrency",
        "url": "https://go.dev/doc/effective_go#concurrency"
      },
      {
        "label": "Go memory model",
        "url": "https://go.dev/ref/mem"
      },
      {
        "label": "Go GC guide",
        "url": "https://go.dev/doc/gc-guide"
      },
      {
        "label": "TinyGo project",
        "url": "https://tinygo.org/"
      }
    ],
    "thesis": "Go popularized the right maxim: 'Do not communicate by sharing memory; share memory by communicating.' But Go does not enforce that principle across ordinary mutable variables. AttoLang's actor model aims to turn it into a structural guarantee while preserving goroutine-like Tasks, adding typed supervision and letting native zero-GC profiles serve workloads where collector activity matters.",
    "benefits": [
      {
        "title": "Communication is the boundary",
        "detail": "Actor-owned mutable heaps and typed messages aim to ensure the safe path is passing ownership, not accidentally sharing and locking state."
      },
      {
        "title": "Goroutine-like work plus fault domains",
        "detail": "Lightweight nb Tasks are distinct from actors with supervised lifecycle, mailboxes and recoverable failures."
      },
      {
        "title": "Choose an explicit memory profile",
        "detail": "A strict native LLVM path targets zero runtime GC, while managed profiles can trade predictability for convenience."
      }
    ],
    "useCases": [
      {
        "title": "High-concurrency infrastructure",
        "detail": "Services with many independently supervised sessions, tenant workloads or plugins and a mix of I/O plus CPU work."
      },
      {
        "title": "Predictable-latency workers",
        "detail": "Native event processing where explicit allocation lifetime and isolated state could reduce runtime interference."
      }
    ]
  },
  {
    "id": "nodejs",
    "name": "Node.js",
    "headline": "Node.js made asynchronous I/O easy. AttoLang wants safe parallel code to be just as easy.",
    "strength": "Node.js delivers an extraordinary npm ecosystem, approachable JavaScript, async/await, fast startup for many deployments, strong network I/O and excellent diagnostics. Worker threads, child processes, transferable ArrayBuffers and SharedArrayBuffer already offer real parallel strategies.",
    "angles": [
      {
        "topic": "Event loop versus multicore scheduling",
        "peer": "A typical Node.js JavaScript worker processes callbacks on a single event-loop thread. libuv's pool handles selected native operations; it does not execute arbitrary JS callbacks on those worker-pool threads.",
        "oreslang": "AttoLang targets a configurable M:N pool running Tasks and actors across physical cores without forcing application code into a main-JS-thread bottleneck. Blocking/suspending operations should cooperate with scheduling.",
        "impact": "A CPU-heavy handler need not stall unrelated JS callbacks merely because the app chose the single-event-loop default."
      },
      {
        "topic": "Worker threads and isolation cost",
        "peer": "Node Worker threads provide parallel JavaScript execution with separate V8 isolates. They can transfer buffers and use SharedArrayBuffer for shared memory; they are not equivalent to OS processes but still carry isolate/runtime overhead.",
        "oreslang": "AttoLang's actor model is designed for many logical actors per runtime, with actor-owned mutable state and shared authorized immutable code, not one independent language isolate for every actor.",
        "impact": "Aim for finer-grained isolation and task switching without multiplying full JS execution contexts."
      },
      {
        "topic": "Memory safety of communication",
        "peer": "JavaScript is memory-safe in many respects, yet mutable shared buffers require Atomics and discipline, and TypeScript type annotations are not runtime-enforced ownership rules.",
        "oreslang": "Compile-time ownership, typed ActorRef messages and authorized zero-copy immutable sharing aim to constrain how data moves between concurrent parts.",
        "impact": "Parallelism becomes a property developers can reason about statically instead of a maze of copied buffers and implicit mutable aliases."
      },
      {
        "topic": "Hot code and recoverability",
        "peer": "Hot module replacement, clusters, workers and orchestration can reload Node code, but consistent in-flight message handling, capability changes and state migration remain app/framework responsibilities.",
        "oreslang": "AttoLang plans actor generations, staged hot loading, supervisor-directed recovery and explicit mailbox/capability boundaries. Reload one stateful component without claiming the entire process has been restarted.",
        "impact": "The desired primitive is 'replace this worker safely' rather than 'restart everything and rebuild every connection.'"
      },
      {
        "topic": "Native compute and cold-start profiles",
        "peer": "Node can use native addons, WebAssembly and Worker threads for performance work. Every option has ecosystem and integration tradeoffs; Node's startup can already be excellent for many use cases.",
        "oreslang": "LLVM AOT and native memory profiles aim to place numerical loops and supervision in one language, with GraalVM offering a different managed/JIT tradeoff.",
        "impact": "The opportunity is cleaner integration of event-driven services with CPU-intensive kernels; not an unmeasured blanket throughput victory over V8."
      }
    ],
    "boundary": "Use Node.js for mature JS ecosystems, web tooling and the npm integration surface. AttoLang's distinct bet is native multicore Tasks plus inexpensive logical actors, typed ownership and built-in supervision—while acknowledging Node already offers worker threads and shared buffers.",
    "sources": [
      {
        "label": "Node.js event loop",
        "url": "https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick"
      },
      {
        "label": "Node.js worker threads",
        "url": "https://nodejs.org/api/worker_threads.html"
      },
      {
        "label": "Node.js don't block event loop",
        "url": "https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop"
      }
    ],
    "thesis": "Node.js is a triumph of the event-driven model, but its default JavaScript execution path centers on one event-loop thread per worker environment. AttoLang's design starts from parallel Tasks and isolated actors: keep the expressive async programming style while giving multicore CPUs, typed mutable-state boundaries and supervised code replacement a first-class place.",
    "benefits": [
      {
        "title": "Parallel app code, not only parallel I/O",
        "detail": "Run many lightweight Tasks across an M:N scheduler in one process; worker counts adapt to actual CPUs and workloads rather than a promised fixed number."
      },
      {
        "title": "Actors without an isolate per actor",
        "detail": "Actors are intended to own mutable heaps while trusted immutable code may be shared within authorized domains, avoiding the cost of one V8 isolate per logical actor."
      },
      {
        "title": "Safe hot-running extensions",
        "detail": "Supervise independently reloadable actor code and constrain its state and capabilities, rather than relying entirely on process restarts or custom worker protocols."
      }
    ],
    "useCases": [
      {
        "title": "CPU-heavy real-time gateways",
        "detail": "Streaming, codec, transformation and local inference work that must run concurrently with network-facing sessions."
      },
      {
        "title": "Reloadable multi-tenant plugin hosts",
        "detail": "Lots of small stateful plugins that need bounded mailboxes, controlled capabilities and hot replacement."
      }
    ]
  },
  {
    "id": "csharp",
    "name": "C#",
    "headline": "C# gave async/await a home. AttoLang wants actors and ownership to feel just as native.",
    "strength": "C# brought modern language ergonomics to application development, including async/await in C# 5, Task-based asynchronous programming, LINQ, strong typing, native AOT and rich tooling. Orleans provides a production virtual-actor model, and .NET's GC is sophisticated.",
    "angles": [
      {
        "topic": "Async/await is not state isolation",
        "peer": "C# async/await is outstanding for suspending asynchronous operations without blocking a thread. A Task does not stop shared objects from being concurrently mutated, and async code can still require locks.",
        "oreslang": "AttoLang's Tasks similarly handle concurrent work, but its actor concept aims to reserve mutable state to actor-private arenas and typed callbacks, with explicit message transfer.",
        "impact": "Scheduling throughput and protection of mutable state become separate guarantees, both designed into the language."
      },
      {
        "topic": "Orleans and the actor framework layer",
        "peer": "Orleans is a mature virtual-actor system with activation, distribution and persistence models. Other .NET actor frameworks support messaging and supervision.",
        "oreslang": "AttoLang aims to make actors a core language/runtime abstraction, including typed ActorRef<T>, lifetime/borrow rules, supervision and hot code generations across backends.",
        "impact": "A developer should not need a distributed framework just to obtain local mutable-state confinement."
      },
      {
        "topic": "Shared heap versus explicit domains",
        "peer": ".NET managed objects can be shared among threads; locking, immutable collections and disciplined ownership patterns make this safe when applied correctly.",
        "oreslang": "AttoLang proposes actor-owned mutable memory, checked borrows and explicit safe sharing domains for immutable zero-copy data. Unsafe native interop remains a separate trust boundary.",
        "impact": "Cross-component sharing is an intentional operation with explicit rights, not a default property of an object reference."
      },
      {
        "topic": "GC, AOT and memory predictability",
        "peer": ".NET supports native AOT and advanced server, background and low-latency GC modes. Native AOT does not itself mean that a managed .NET app is GC-free.",
        "oreslang": "The LLVM profile targets a non-tracing zero-GC memory discipline for supported programs; GraalVM AttoLang can use managed GC. Actual latency depends on allocation, scheduling and workload.",
        "impact": "A build profile can express stricter memory lifetime needs without discarding async/actor abstractions."
      },
      {
        "topic": "Reload, isolation and portable runtimes",
        "peer": ".NET has AssemblyLoadContext, dynamic loading, hot reload tooling and mature hosting, but safe unloading and migration of live state are design challenges.",
        "oreslang": "Versioned actors, staged rollout/rollback and supervisor recovery are intended as consistent runtime contracts across LLVM and GraalVM, without assuming every backend supports the same features today.",
        "impact": "Hot-swappable stateful services can be a core architectural unit rather than a deployment trick."
      }
    ],
    "boundary": "C# and Orleans are mature, serious alternatives; C# also offers native AOT. AttoLang is not claiming to have invented async/await or actors. Its opportunity is integrating actor-owned memory and hot-reload supervision at the language boundary with a native zero-GC option.",
    "sources": [
      {
        "label": "C# asynchronous programming",
        "url": "https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/"
      },
      {
        "label": "Microsoft Orleans overview",
        "url": "https://learn.microsoft.com/en-us/dotnet/orleans/overview"
      },
      {
        "label": "Native AOT deployment",
        "url": "https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/"
      },
      {
        "label": "AssemblyLoadContext",
        "url": "https://learn.microsoft.com/en-us/dotnet/core/dependency-loading/understanding-assemblyloadcontext"
      }
    ],
    "thesis": "C# helped make async/await mainstream and has excellent .NET tooling. AttoLang takes the next structural step: distinguish lightweight Tasks from supervised actors, make mutable ownership an explicit boundary and offer both managed and native no-GC execution profiles. The design goal is a system where concurrent work, state isolation and code evolution reinforce each other.",
    "benefits": [
      {
        "title": "Enforced actor ownership",
        "detail": "Actors are intended to be language-level units of state isolation with typed mailboxes rather than ordinary shared objects disciplined by a framework."
      },
      {
        "title": "Task and actor semantics together",
        "detail": "Use nb Tasks for short-lived concurrency, actors for isolation/supervision and await/select for scheduling without collapsing these into one abstraction."
      },
      {
        "title": "Native mode outside .NET GC",
        "detail": "A strict LLVM profile targets zero tracing-GC execution, with a separate managed profile where GC is desirable."
      }
    ],
    "useCases": [
      {
        "title": "Long-lived service and plugin hosts",
        "detail": "Stateful tenants or extensions needing supervised updates with typed messaging and narrow permissions."
      },
      {
        "title": "Native async edge services",
        "detail": "Short-lived agents or high-load service workers balancing native memory constraints and async orchestration."
      }
    ]
  },
  {
    "id": "ocaml",
    "name": "OCaml",
    "headline": "OCaml knows how to make illegal states unrepresentable. AttoLang adds an actor-shaped runtime.",
    "strength": "OCaml has impressive type inference, algebraic data types, pattern matching, native compilation and a rich functional programming tradition. OCaml 5 adds Domains for multicore parallelism, with effect-handler-based concurrency libraries such as Eio.",
    "angles": [
      {
        "topic": "Expressive types versus ownership checking",
        "peer": "OCaml infers rich types and supports modules, functors and ADTs, but ordinary native OCaml memory is still GC-managed and mutable sharing is not governed by a Rust-style borrow checker.",
        "oreslang": "AttoLang combines static types, Option/Result patterns, nominal and structural shapes with ownership/borrowing and actor-private state boundaries.",
        "impact": "Make concurrency and lifetime violations harder to express, not only ordinary invalid domain values."
      },
      {
        "topic": "OCaml 5 Domains and fibers",
        "peer": "OCaml 5 Domains enable genuine multicore parallel execution; effect handlers support sophisticated cooperative task libraries including Eio. OCaml is not fundamentally single-threaded.",
        "oreslang": "AttoLang plans an integrated M:N Task scheduler for await/select plus actors for independent state, mailbox ownership and supervision. Actors should not be mandatory for numerical kernels.",
        "impact": "The runtime itself defines the division between parallel work and fault-tolerant mutable state."
      },
      {
        "topic": "GC and native control",
        "peer": "OCaml compiles to native code with an efficient runtime, but tracing garbage collection is part of its usual memory model and may affect allocation-sensitive workloads.",
        "oreslang": "The strict LLVM profile targets arena/ownership-based allocation with no runtime GC; GraalVM mode remains a different memory strategy.",
        "impact": "The long-term target is explicit allocation predictability for engines, simulation, native services and embedded subsets."
      },
      {
        "topic": "Fault tolerance and recovery",
        "peer": "OCaml applications can implement processes, queues, restart policies and concurrency frameworks. OTP-style actor supervision and hot swaps are not OCaml language-level primitives.",
        "oreslang": "Actor supervision, typed messages, panic escalation, code generations and controlled reload are central AttoLang semantics under development.",
        "impact": "Recoverability moves from application architecture into a reusable, inspectable runtime contract."
      },
      {
        "topic": "Data orientation and accelerators",
        "peer": "OCaml can use bigarrays, C bindings and native libraries for performance work, and its compiler produces efficient machine code for many domains.",
        "oreslang": "AttoLang targets columnar data layouts, zero-copy region borrows and later CPU/GPU-targeted kernels that actors coordinate without per-entity overhead.",
        "impact": "The proposed architecture unifies cache-local compute and resilient coordination without making either an afterthought."
      }
    ],
    "boundary": "OCaml is a mature and compelling choice for typed functional software and native compilers. AttoLang's differentiator is actor isolation, supervised code evolution and native ownership/no-GC profiles; its implementation and tooling still need verification.",
    "sources": [
      {
        "label": "OCaml parallelism and Domains",
        "url": "https://ocaml.org/manual/5.4/parallelism.html"
      },
      {
        "label": "OCaml effect handlers",
        "url": "https://ocaml.org/manual/5.3/effects.html"
      },
      {
        "label": "OCaml language overview",
        "url": "https://ocaml.org/about"
      }
    ],
    "thesis": "OCaml has long shown what a precise functional type system can do for software design. AttoLang aims to carry that rigor into mutable memory, concurrent execution and failure containment: compile-time borrowing, typed actor mailboxes, supervisor trees and hot reload, together with a native no-GC target.",
    "benefits": [
      {
        "title": "From values to ownership",
        "detail": "Reason statically not just about data variants but about exclusive mutation, actor-private arenas and safe transfer."
      },
      {
        "title": "Parallel computation plus supervision",
        "detail": "A built-in Task/Actor split aims to combine fine-grained multicore work with recoverable, message-driven components."
      },
      {
        "title": "Predictable native memory profiles",
        "detail": "LLVM zero-GC goals and explicit lifetime management target scenarios where collection overhead is unwelcome."
      }
    ],
    "useCases": [
      {
        "title": "Typed high-availability engines",
        "detail": "Rule engines, data processors and embedded decision systems needing both exhaustive modeling and supervised stateful execution."
      },
      {
        "title": "Native data pipelines",
        "detail": "Batch and streaming numerical work where columnar memory layout, explicit lifetime and actor boundaries matter."
      }
    ]
  }
];
