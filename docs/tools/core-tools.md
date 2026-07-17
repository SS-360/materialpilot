# Core tool reference

All mutating tools are annotated as writes and carry MaterialPilot safety metadata.

| Tool                                               | Class | Purpose                                               |
| -------------------------------------------------- | ----- | ----------------------------------------------------- |
| `app_get_status`                                   | A0    | Connection, active project, mode, and versions.       |
| `app_get_capabilities`                             | A0    | Feature flags and limits.                             |
| `project_list` / `project_get_active`              | A0    | Observe project state.                                |
| `project_create_material`                          | A1    | Create an editable project with a PBR output.         |
| `project_validate`                                 | A0    | Structural, standard, strict, or release validation.  |
| `graph_get_summary` / `graph_get_snapshot`         | A0    | Compact or canonical graph observation.               |
| `graph_find_nodes` / `graph_trace_dependencies`    | A0    | Targeted graph analysis.                              |
| `graph_plan_patch`                                 | A0    | Dry-run a patch and return validation/diff evidence.  |
| `graph_apply_patch`                                | A1    | Revision-safe, idempotent atomic mutation.            |
| `graph_undo` / `graph_redo`                        | A1    | Reversible history operation with a new revision.     |
| `preview_render_node_output`                       | A0    | Bounded in-memory PNG render of one native output.    |
| `catalog_*`                                        | A0    | Search and inspect typed node descriptors.            |
| `node_create`, `node_delete`, `node_set_parameter` | A1    | Atomic convenience wrappers over patches.             |
| `connection_create`, `connection_delete`           | A1    | Typed atomic connection wrappers.                     |
| `workflow_create_material`                         | A1    | Deterministic baseline project and graph transaction. |

The complete planned surface is documented in `materialpilot-production-implementation-plan.md`. Tools whose native safety contract is not implemented are omitted instead of being registered as misleading stubs.
