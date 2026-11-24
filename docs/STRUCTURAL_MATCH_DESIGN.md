# Structural match patterns (language-design contract)

The canonical AttoLang pattern spelling uses `~` as syntactic sugar for
`structural`. An optional variable binding **always uses `as`**.
These are language-design examples, **not evidence of successful compiler
execution across backends**.

```atto
match account over
  on ~ {id: string, active: bool} as a -> {
    return a.id;
  }
  on _ -> { return "unknown"; }
end
```

The explicit, semantically equivalent spelling is:

```atto
match account over
  on structural {id: string, active: bool} as a -> {
    return a.id;
  }
  on _ -> { return "unknown"; }
end
```

Named structural shapes use the same binding marker:
`on structural HasName as named -> { ... }`.

## Matching contract

- A structural pattern tests the **presence and compatible static types** of
  every named field; declaration names and nominal identities do not matter.
- **Records, structs and classes** are eligible. Extra fields do not invalidate
  a match. For example, a class with `id: string`, `active: bool` and
  `created_at: int` satisfies the two-field pattern.
- Missing `id` or `active`, or `active: string`, does not satisfy that
  pattern. Maps/dictionaries are not automatically treated as field-bearing
  objects; dynamic reflection is not implied.
- A class contributes only its **accessible instance fields/properties**;
  private or actor-sealed state must not be bypassed. Getter side effects,
  mutation and implicit object copying are not part of the match.
- `as a` introduces an arm-local binding available to the guard and body,
  exposing only capabilities justified by the checked shape and the source
  value's visibility/ownership. It does not extend a borrow's lifetime or
  grant mutation rights.
- The scrutinee is evaluated once. Arms are evaluated in source order. The
  final `on _` arm handles values without a compatible shape.

## Parser and tooling compatibility

```ebnf
structural_pattern = ("~" | "structural") type_ref ["as" IDENT] ;
```

Here `type_ref` may be the inline record-shaped type
`{id: string, active: bool}` or a named structural type. `~ { ... }` is
distinct from the existing `~(field: pattern)` record-pattern form and from
tilde-prefixed collection constructors. A positional binding such as
`on ~ {id: string} a` is **not** canonical and must not be accepted as a
new-form alias.

Older `on structural SomeShape name` code may remain accepted during
migration; the formatter should emit `on structural SomeShape as name` (or
the equivalent `~ SomeShape as name`).

## Verification needed before calling this supported

Parser accept/reject tests; type checks for each of record/struct/class;
extra/missing/mismatched/inaccessible fields; arm-local binding scope,
borrows and visibility; interpreted/JIT and AOT execution; cross-backend
conformance. Website/highlighter checks alone are not compiler verification.
