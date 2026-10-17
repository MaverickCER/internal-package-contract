---
"internal-package-contract": minor
---

feat(verify-consumers): `verify-consumers <checkout>...` runs each dependent package's fast offline checks with the standard it has installed and with this one, in throwaway copies, and names every check that got worse; it also says where an install would add its own copy of a package the standard depends on
