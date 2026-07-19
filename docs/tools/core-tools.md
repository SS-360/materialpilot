# MCP tool reference

MaterialPilot 0.1.0 negotiates **143 tools**. All tools have JSON-compatible input schemas, MCP
read/write annotations, and MaterialPilot safety metadata. A0 tools are observational. A1 tools
perform reversible in-memory project or graph mutations and require the configured permission
policy.

| Category                |   Count | Primary capability                                         |
| ----------------------- | ------: | ---------------------------------------------------------- |
| Application             |       6 | Runtime, versions, connection, features, and limits        |
| Project                 |      11 | Native creation, save, discovery, metadata, and validation |
| Graph observation       |      18 | Snapshots, paths, bounds, statistics, and reachability     |
| Transactions and patch  |       9 | Plan, validate, apply, recovery, history, undo, and redo   |
| Catalog                 |      15 | Typed descriptors, parameters, aliases, and compatibility  |
| Node                    |      24 | Observation plus atomic and batch editing                  |
| Connection and port     |      15 | Inspection, compatibility, replace, and batch mutation     |
| Layout                  |       7 | Alignment, distribution, grids, offsets, and centering     |
| Material/PBR            |      13 | Outputs, channels, export, configuration, and validation   |
| Preview                 |       6 | Bounded node-output and material PNG rendering             |
| Diagnostics/performance |       8 | Validation views, summaries, and graph metrics             |
| Workflow                |      11 | Baseline and five procedural material recipes              |
| **Total**               | **143** |                                                            |

## Application and project

- `app_get_status`, `app_get_capabilities`, `app_ping`, `app_get_version`,
  `app_get_runtime_health`, `app_get_feature_matrix`
- `project_list`, `project_get_active`, `project_create_material`, `project_validate`,
  `project_get`, `project_get_metadata`, `project_get_graphs`, `project_is_dirty`,
  `project_get_compatibility`, `project_assert_revision`, `project_save`

`project_create_material` is A1 and creates a clean, active, unsaved Material Maker material tab
with a standard Material output. It uses an idempotency key; rejected creation leaves no partial tab.
`project_save` is A2 and requires approval, an expected revision, an idempotency key, and a
workspace-policy-approved `.ptex` path.

## Graph observation and transactions

- `graph_get_summary`, `graph_get_snapshot`, `graph_find_nodes`, `graph_trace_dependencies`,
  `graph_get_hierarchy`, `graph_get_selection`, `graph_get_bounds`, `graph_get_statistics`,
  `graph_get_outputs`, `graph_get_connections`, `graph_get_adjacency`,
  `graph_get_connected_components`, `graph_get_revision`, `graph_explain_path`,
  `graph_find_unreachable_nodes`, `graph_find_redundant_nodes`, `graph_find_expensive_chains`
- `graph_plan_patch`, `graph_apply_patch`, `graph_undo`, `graph_redo`,
  `graph_list_transactions`, `graph_get_transaction`, `graph_estimate_patch_cost`,
  `graph_validate_patch`, `graph_create_named_snapshot`, `graph_list_named_snapshots`

Graph mutations remain revision-checked, idempotent, atomic, validated, and rollback-safe. Layout,
batch, PBR, and workflow tools all compile down to the same graph-patch transaction path.

## Catalog

- `catalog_list_categories`, `catalog_search_nodes`, `catalog_get_node_type`,
  `catalog_get_compatible_nodes`, `catalog_get_version`, `catalog_list_nodes`,
  `catalog_get_inputs`, `catalog_get_outputs`, `catalog_get_parameters`,
  `catalog_find_by_alias`, `catalog_find_by_tag`, `catalog_list_sources`,
  `catalog_list_filters`, `catalog_list_outputs`, `catalog_check_connection`

## Nodes

- `node_create`, `node_delete`, `node_set_parameter`, `node_get`, `node_get_parameters`,
  `node_get_parameter`, `node_list_ports`, `node_get_input`, `node_get_output`,
  `node_list_connections`, `node_get_dependencies`, `node_get_consumers`, `node_is_reachable`,
  `node_validate`, `node_describe`, `node_set_parameters`, `node_reset_parameter`, `node_move`,
  `node_duplicate`, `node_select`, `node_select_all`, `node_clear_selection`, `node_delete_many`,
  `node_move_many`

## Connections and ports

- `connection_create`, `connection_delete`, `port_get`, `port_list_connections`,
  `connection_get`, `connection_validate`, `connection_find_open_inputs`,
  `connection_find_output_consumers`, `connection_list_for_node`, `connection_can_create`,
  `connection_replace`, `connection_disconnect_input`, `connection_disconnect_node`,
  `connection_create_many`, `connection_delete_many`

## Layout and Material/PBR

- `layout_align_left`, `layout_align_top`, `layout_distribute_horizontal`,
  `layout_distribute_vertical`, `layout_grid`, `layout_offset`, `layout_center`
- `material_list_outputs`, `material_get_output`, `material_list_channels`,
  `material_get_channel`, `material_connect_channel`, `material_disconnect_channel`,
  `material_get_channel_lineage`, `material_validate_pbr`, `material_configure_output`,
  `material_set_resolution`, `material_set_transparency`, `material_set_depth_scale`,
  `material_export_blender`

## Preview, diagnostics, and performance

- `preview_render_node_output`, `preview_get_configuration`, `preview_can_render_node`,
  `preview_list_renderable_nodes`, `preview_list_node_outputs`, `preview_render_material_3d`
- `diagnostics_validate_structural`, `diagnostics_validate_standard`,
  `diagnostics_validate_strict`, `diagnostics_validate_release`, `diagnostics_get_errors`,
  `diagnostics_get_warnings`, `diagnostics_summarize`, `performance_get_graph_metrics`

## Workflows

- `workflow_create_material`
- `workflow_create_cracked_stone`, `workflow_apply_cracked_stone`
- `workflow_create_basalt`, `workflow_apply_basalt`
- `workflow_create_sandstone`, `workflow_apply_sandstone`
- `workflow_create_lava`, `workflow_apply_lava`
- `workflow_create_oxidized_metal`, `workflow_apply_oxidized_metal`

The `create` variants open a new native material tab and populate it. The `apply` variants mutate an
existing active root graph. They use only negotiated catalog nodes and return the same validation,
diff, revision, and transaction evidence as lower-level patches.

The longer production roadmap targets 150+ tools including additional export profiles, asset
libraries, custom nodes, mesh maps, subgraph mutation, and painting. Those surfaces are not
registered as misleading stubs while their native safety and rollback contracts remain unavailable.
