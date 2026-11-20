// Editorial themes: inclusion does not mean corresponding functionality has shipped.
export const languageProgress = [
  {
    "id": "capabilities",
    "label": "Permissions + secure runtimes",
    "shift": "Capability-oriented runtimes, Deno-style permissions, WASI and FaaS made it important to constrain which host resources a workload may use.",
    "response": "AttoLang proposes explicit actor trust classes, typed message boundaries and host-granted capabilities instead of ambient authority for multi-tenant code.",
    "forward": "Make denial, revocation, quotas and trust boundaries testable per backend; treat sandbox escape as a correctness failure."
  },
  {
    "id": "gpu",
    "label": "GPUs + heterogeneous compute",
    "shift": "CUDA predates 2010, but GPU computing became central to machine learning, simulation and other general-purpose workloads during 2010–2022.",
    "response": "AttoLang's data-oriented and accelerator plans aim for typed CPU/GPU transfer contracts and explicit kernel boundaries, while actors coordinate work.",
    "forward": "Prove layouts, transfers and device capabilities with actual compiled kernels before claiming a GPU backend or performance gains."
  },
  {
    "id": "latency",
    "label": "Low latency + HPC / HFT",
    "shift": "Hardware-aware layouts, SIMD, modern C++ and specialized runtimes made tail latency and throughput first-class design concerns.",
    "response": "AttoLang explores actor-owned arenas, bounded mailboxes, native lifetime control and AOT/JIT paths; fast average responses are not a latency guarantee.",
    "forward": "Measure p99/p99.9 latency, allocation jitter and end-to-end behavior on reproducible HPC and trading workloads."
  },
  {
    "id": "data-oriented",
    "label": "Data-oriented programming",
    "shift": "Data-oriented design emphasized structuring memory around access patterns, cache locality, SIMD and contiguous data rather than object graphs alone.",
    "response": "AttoLang aims for typed data layouts, array-of-structs and struct-of-arrays choices, and CPU/GPU-friendly buffers within its ownership and actor model.",
    "forward": "Validate layout and aliasing guarantees across backends and benchmark real workloads before claiming performance wins."
  },
  {
    "id": "verification",
    "label": "Formal methods + contracts",
    "shift": "Long-established techniques such as model checking and proof assistants became more visible in infrastructure and safety-critical engineering.",
    "response": "AttoLang aims to make effects, typed messages and failures checkable; Zorde's contract design uses independent TypeSpec and JSON Schema authorities, with WIT at component boundaries.",
    "forward": "Model-check supervision, cancellation and transport invariants; reject contract drift and publish independently reproducible evidence."
  },
  {
    "id": "ownership",
    "label": "Borrow checking + Option types",
    "shift": "Rust's ownership model and the spread of null-aware types showed that memory and absence errors can be addressed before deployment.",
    "response": "AttoLang combines ownership and borrowing goals with Option-safe APIs, exhaustive matching and actor confinement; native and managed backends may use different GC strategies.",
    "forward": "Prove lifetime, sendability, escape and cross-actor safety rules for each backend instead of assuming one memory strategy solves everything."
  },
  {
    "id": "typing",
    "label": "Gradual typing + static guarantees",
    "shift": "TypeScript, Python type hints and richer mainstream type systems helped large applications regain tooling and refactoring confidence.",
    "response": "AttoLang begins with static types, nominal and structural shapes, typed messaging and checkable contracts, rather than optional annotations on a dynamic core.",
    "forward": "Keep type inference ergonomic while verifying library, serialization and foreign-function boundaries."
  },
  {
    "id": "async",
    "label": "Async/await + cloud concurrency",
    "shift": "Async/await spread across ecosystems while lightweight tasks and cloud-native services changed I/O, cancellation and failure management.",
    "response": "AttoLang combines async/await, select, channels and actors, distinguishing in-flight work from simultaneously executing actor code.",
    "forward": "Make backpressure, scheduling fairness, cancellation, supervision and shutdown observable under load, including uncooperative tasks."
  },
  {
    "id": "wasm",
    "label": "WebAssembly + portable modules",
    "shift": "WebAssembly expanded browser execution options and began reaching portable server-side and component workloads.",
    "response": "AttoLang's multi-backend direction targets shared semantics across JVM/GraalVM, native LLVM and future Wasm/WASI integration, using WIT for component interfaces.",
    "forward": "Validate real compiled Wasm components, host capabilities and ABI compatibility before claiming backend conformance."
  },
  {
    "id": "functional",
    "label": "Functional features in the mainstream",
    "shift": "Lambdas, immutable data, pattern matching and algebraic-data-type ideas became common beyond purely functional languages.",
    "response": "AttoLang treats functions as values, purity, pattern matching, immutable state and typed actor events as complementary paradigms.",
    "forward": "Preserve predictable capture, exhaustive matches and explicit effects across composition, concurrency and code generation."
  },
  {
    "id": "ai-data",
    "label": "AI + data-science workflows",
    "shift": "Python succeeded as a readable orchestration layer for native numerical libraries and GPU frameworks.",
    "response": "AttoLang aims to combine approachable orchestration with typed numerical and columnar data, actor pipelines and native-compiled kernels.",
    "forward": "Build and benchmark interoperable numerical libraries and accelerator boundaries; do not claim a drop-in Python/PyTorch replacement."
  },
  {
    "id": "ui",
    "label": "Cross-platform UI consolidation",
    "shift": "Electron, React Native and Flutter popularized reuse across desktop and mobile through shared runtimes and frameworks.",
    "response": "AttoLang's portable runtime and actor-isolation direction could support shared application logic with thin platform-specific UI and capability adapters.",
    "forward": "Prove platform bindings, lifecycle and accessibility before claiming a cross-platform UI toolkit; none is shipped today."
  }
];
