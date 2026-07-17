# Material Maker 1.7 integration map

This map was produced from the upstream `1.7` tag.

| Concern             | Upstream entry point                                                                       | MaterialPilot adapter strategy                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Project lifecycle   | `material_maker/main_window.gd` (`do_load_project`, `save_project`, `get_current_project`) | Query the active project through `mm_globals.main_window`; preserve dirty state and native paths.                      |
| Material graph UI   | `material_maker/panels/graph_edit/graph_edit.gd` (`MMGraphEdit`)                           | Observe `top_generator.serialize()`, use `do_create_nodes`, `do_connect_node`, `do_remove_node`, and refresh the view. |
| Graph model         | `addons/material_maker/engine/nodes/gen_graph.gd` (`MMGenGraph`)                           | Treat serialized nodes and connections as the native source of truth; never expose object references.                  |
| Node factory        | `material_maker/node_factory.gd` and `mm_loader.add_to_gen_graph`                          | Create generic nodes from installed `.mmg` descriptors and runtime loaders.                                            |
| Undo/redo           | `material_maker/tools/undo_redo/undo_redo.gd` and `MMGraphEdit.undoredo_create_step`       | Submit one meaningful undo entry per committed MaterialPilot patch.                                                    |
| Serialization       | `MMGenGraph._serialize`, `_deserialize`, and `MMGraphEdit.save_file`                       | Take a deep serialized pre-state before mutation and deserialize it on failure.                                        |
| 2D preview          | `material_maker/panels/preview_2d/preview_2d_panel.gd`                                     | Future adapter must capture a deterministic image without blocking the UI. Capability is currently false.              |
| 3D preview and maps | preview panels and `addons/material_maker/map_generator`                                   | Future job-based adapter with one render at a time and cancellation.                                                   |
| Export              | `main_window.gd` (`export_material`) and material/export generators                        | Future A3 job adapter; preflight and verify artifacts before reporting success.                                        |
| Painting project    | `material_maker/panels/paint/paint.gd`                                                     | Read model, settings, brush graph, and layer tree first. Stroke automation stays disabled.                             |
| Painting layers     | `paint_layers.gd` and `layer_types/*`                                                      | `.mmpp` adapter models paint, procedural, and mask layers plus channel opacity and references.                         |

The native bridge is isolated under `apps/material-maker-bridge/addon/materialpilot`. Generic extension hooks should be proposed upstream rather than maintaining invasive patches.
