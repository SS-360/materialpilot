# First material

1. Run `materialpilot doctor` and confirm Node and workspace checks pass.
2. Start Material Maker with the addon or explicitly set `MATERIALPILOT_OFFLINE=1` for the reference engine.
3. Call `app_get_status`, then `catalog_search_nodes` for the concepts you need.
4. Use `workflow_create_material` for the deterministic noise/color/normal baseline, or create a project and prepare a `graph_plan_patch`.
5. Inspect the planned diff and warnings.
6. Apply the same patch against the inspected revision.
7. Call `project_validate` with `standard` or `strict`.

The baseline workflow is structurally valid but artistically neutral. Live preview/export adapters report unavailable rather than pretending that graph validity proves visual quality.
