extends Node

var _revisions: Dictionary = {}
var _idempotency: Dictionary = {}

func get_material_maker_version() -> String:
	var version := str(ProjectSettings.get_setting("application/config/version", ""))
	return "1.7" if version.strip_edges().is_empty() else version

func get_features() -> Dictionary:
	var graph = _current_graph()
	var editable := _is_root_graph(graph)
	return {
		"application.read": true,
		"project.read": true,
		"project.create": _main_window() != null,
		"project.save": editable,
		"graph.read": graph != null,
		"graph.write": editable,
		"graph.transactions": editable,
		"catalog.read": true,
		"preview.capture": graph != null,
		"preview.nodeOutput": graph != null,
		"preview.material3d": graph != null and _main_window() != null,
		"export.write": editable,
		"painting.read": _current_project_type() == "painting",
		"painting.stroke": false,
		"customNode.write": false
	}

func get_status(instance_id: String, bridge_version: String) -> Dictionary:
	var projects := list_projects()
	var active := get_active_project()
	return {
		"running": true,
		"instanceId": instance_id,
		"bridgeVersion": bridge_version,
		"materialMakerVersion": get_material_maker_version(),
		"godotVersion": Engine.get_version_info().string,
		"activeProjectId": active.get("id") if !active.is_empty() else null,
		"connectedProjectCount": projects.size()
	}

func list_projects() -> Array:
	var main = _main_window()
	if main == null:
		return []
	if !("projects_panel" in main) or main.projects_panel == null:
		return []
	var tabs = main.projects_panel.get_projects()
	var current = main.get_current_project() if main.has_method("get_current_project") else null
	var projects: Array = []
	for index in tabs.get_tab_count():
		var project = tabs.get_child(index)
		projects.append(_project_summary(project, project == current))
	return projects

func get_active_project() -> Dictionary:
	var main = _main_window()
	if main == null or !main.has_method("get_current_project"):
		return {}
	var project = main.get_current_project()
	return {} if project == null else _project_summary(project, true)

func create_material_project(params: Dictionary):
	var requested_name := str(params.get("name", "")).strip_edges()
	if requested_name.is_empty() or requested_name.length() > 120:
		return _error(-32602, "Project name must contain between 1 and 120 characters")
	var key := str(params.get("idempotencyKey", ""))
	if key.length() < 8 or key.length() > 200:
		return _error(-32602, "An idempotency key between 8 and 200 characters is required")
	var scoped_key := "project-create:" + key
	var request_hash := _hash_value({"name": requested_name})
	if _idempotency.has(scoped_key):
		if _idempotency[scoped_key].hash != request_hash:
			return _error(-32602, "Idempotency key reused with different arguments")
		return _idempotency[scoped_key].result
	var main = _main_window()
	if main == null or !main.has_method("new_graph_panel") or !("projects_panel" in main):
		return _error(-32030, "CAPABILITY_NOT_AVAILABLE")
	var tabs = main.projects_panel.get_projects()
	var previous_tab: int = tabs.current_tab
	var graph = main.new_graph_panel()
	if graph == null:
		return _error(-32020, "Could not create a Material Maker graph panel")
	graph.set_meta("materialpilot_project_name", requested_name)
	await graph.new_material()
	if graph.top_generator == null or !_structurally_valid(graph):
		_rollback_created_project(tabs, graph, previous_tab)
		return _error(-32020, "Material Maker did not initialize the new material graph")
	if "current_mesh" in main:
		graph.top_generator.set_current_mesh(main.current_mesh)
	_revisions[graph.get_instance_id()] = 0
	graph.set_need_save(false)
	graph.need_save_crash_recovery = false
	if graph.has_signal("graph_changed"):
		graph.graph_changed.connect(_refresh_materialpilot_project_title.bind(graph))
	if graph.has_signal("save_path_changed"):
		graph.save_path_changed.connect(_on_materialpilot_project_save_path_changed.bind(graph))
	_refresh_materialpilot_project_title(graph)
	if "hierarchy" in main and main.hierarchy != null and main.hierarchy.has_method("update_from_graph_edit"):
		main.hierarchy.update_from_graph_edit(graph)
	var result := _project_summary(graph, true)
	_idempotency[scoped_key] = {"hash": request_hash, "result": result}
	return result

func _refresh_materialpilot_project_title(graph) -> void:
	if graph == null or !is_instance_valid(graph) or !graph.has_meta("materialpilot_project_name"):
		return
	if "save_path" in graph and !graph.save_path.is_empty():
		return
	var main = _main_window()
	if main == null or !("projects_panel" in main):
		return
	var title := str(graph.get_meta("materialpilot_project_name"))
	if "need_save" in graph and graph.need_save:
		title += " *"
	main.projects_panel.get_projects().set_tab_title(graph.get_index(), title)

func _on_materialpilot_project_save_path_changed(_changed_graph, _path: String, graph) -> void:
	_refresh_materialpilot_project_title(graph)

func _rollback_created_project(tabs, graph, previous_tab: int) -> void:
	if graph != null and is_instance_valid(graph):
		var created_index: int = graph.get_index()
		if created_index >= 0 and created_index < tabs.get_tab_count():
			tabs.do_close_tab(created_index)
	if previous_tab >= 0 and previous_tab < tabs.get_tab_count():
		tabs.current_tab = previous_tab

func get_graph_snapshot(params: Dictionary):
	var graph = _current_graph()
	if graph == null or !is_instance_valid(graph) or graph.top_generator == null:
		return _error(-32004, "PROJECT_NOT_FOUND")
	var project_id := _active_project_id()
	if params.has("projectId") and params.projectId != project_id:
		return _error(-32004, "PROJECT_NOT_FOUND")
	var serialized := _serialize_graph(graph.top_generator)
	return {
		"projectId": project_id,
		"revision": _revision(graph),
		"graphId": "mmg_native_" + project_id.sha256_text().left(16),
		"serializedGraph": serialized,
		"hash": _graph_hash(serialized),
		"selection": _selection(graph)
	}

func save_project(params: Dictionary):
	var graph = _current_graph()
	if graph == null or params.get("projectId") != _active_project_id():
		return _error(-32004, "PROJECT_NOT_FOUND")
	if params.get("expectedRevision", -1) != _revision(graph):
		return _error(-32010, "REVISION_CONFLICT", {"actualRevision": _revision(graph)})
	var path := str(params.get("path", "")).simplify_path()
	if !path.is_absolute_path() or path.get_extension().to_lower() != "ptex":
		return _error(-32602, "A canonical absolute .ptex path is required")
	if !DirAccess.dir_exists_absolute(path.get_base_dir()):
		return _error(-32602, "The project destination directory does not exist")
	if FileAccess.file_exists(path) and !params.get("overwrite", false):
		return _error(-32022, "OVERWRITE_NOT_ALLOWED")
	var key := str(params.get("idempotencyKey", ""))
	if key.length() < 8:
		return _error(-32602, "An idempotency key is required")
	var scoped_key := _active_project_id() + ":project-save:" + key
	var request_hash := _hash_value(params)
	if _idempotency.has(scoped_key):
		if _idempotency[scoped_key].hash != request_hash:
			return _error(-32602, "Idempotency key reused with different arguments")
		return _idempotency[scoped_key].result
	if !await graph.save_file(path):
		return _error(-32020, "Material Maker failed to save the project")
	var result := _project_summary(graph, true)
	_idempotency[scoped_key] = {"hash": request_hash, "result": result}
	return result

func apply_graph_patch(params: Dictionary):
	var patch: Dictionary = params.get("patch", params)
	var graph = _current_graph()
	if graph == null:
		return _error(-32004, "PROJECT_NOT_FOUND")
	if !_is_root_graph(graph):
		return _error(-32030, "CAPABILITY_NOT_AVAILABLE", {"reason": "Open the root graph before editing."})
	if patch.get("projectId") != _active_project_id():
		return _error(-32004, "PROJECT_NOT_FOUND")
	var expected: int = patch.get("expectedRevision", -1)
	if expected != _revision(graph):
		return _error(-32010, "REVISION_CONFLICT", {"actualRevision": _revision(graph)})
	var key: String = patch.get("idempotencyKey", "")
	if key.length() < 8:
		return _error(-32602, "An idempotency key is required")
	var project_id := _active_project_id()
	var scoped_key := project_id + ":" + key
	var request_hash := _hash_value(patch)
	if _idempotency.has(scoped_key):
		if _idempotency[scoped_key].hash != request_hash:
			return _error(-32602, "Idempotency key reused with different arguments")
		return _idempotency[scoped_key].result
	var operations: Array = patch.get("operations", [])
	if operations.is_empty() or operations.size() > 500:
		return _error(-32602, "Patch must contain between 1 and 500 operations")
	var before := _serialize_graph(graph.top_generator)
	var selection_before := _selection(graph)
	var temporary_native_ids: Dictionary = {}
	var temporary_ids: Dictionary = {}
	var changed: Array = []
	var failure = null
	for operation in operations:
		failure = await _apply_operation(graph, operation, temporary_native_ids, temporary_ids, changed)
		if failure != null:
			break
	if failure != null or !_structurally_valid(graph):
		if !await _restore_graph(graph, before):
			return _error(-32020, "ROLLBACK_FAILED")
		_set_selection(graph, selection_before, {})
		return failure if failure != null else _error(-32020, "TRANSACTION_FAILED")
	var after := _serialize_graph(graph.top_generator)
	if patch.get("dryRun", false):
		if !await _restore_graph(graph, before):
			return _error(-32020, "ROLLBACK_FAILED")
		_set_selection(graph, selection_before, {})
		return {
			"status": "planned",
			"revision": expected,
			"temporaryIds": temporary_ids,
			"temporaryNativeIds": temporary_native_ids,
			"hash": _graph_hash(after),
			"serializedGraph": after
		}
	_materialpilot_undoredo_create_step(
		graph,
		"MaterialPilot: " + patch.get("label", "Graph patch"),
		graph.generator.get_hier_name(),
		before,
		after
	)
	_revisions[graph.get_instance_id()] = expected + 1
	graph.set_need_save(true)
	var result := {
		"status": "committed",
		"revision": expected + 1,
		"temporaryIds": temporary_ids,
		"temporaryNativeIds": temporary_native_ids,
		"changedEntityIds": changed,
		"hash": _graph_hash(after),
		"serializedGraph": after
	}
	_idempotency[scoped_key] = {"hash": request_hash, "result": result}
	return result

func _materialpilot_undoredo_create_step(graph, label: String, parent_path: String, before: Dictionary, after: Dictionary) -> void:
	var clean_before: Dictionary = before.duplicate(true)
	var clean_after: Dictionary = after.duplicate(true)
	var undo_actions: Array = []
	var redo_actions: Array = []
	_extract_leaf_update_actions(clean_before, clean_after, parent_path, undo_actions, redo_actions)
	var structural_actions: Dictionary = graph.undoredo_step_actions(parent_path, clean_before, clean_after)
	if structural_actions.has("undo_actions"):
		undo_actions.append_array(structural_actions.undo_actions)
	if structural_actions.has("redo_actions"):
		redo_actions.append_array(structural_actions.redo_actions)
	if !undo_actions.is_empty() and !redo_actions.is_empty():
		graph.undoredo.add(label, undo_actions, redo_actions, false)

func _extract_leaf_update_actions(previous: Dictionary, next: Dictionary, parent_path: String, undo_actions: Array, redo_actions: Array) -> void:
	if previous.get("type") != "graph" or next.get("type") != "graph":
		return
	var previous_nodes: Array = previous.get("nodes", [])
	var next_nodes: Array = next.get("nodes", [])
	for previous_node in previous_nodes:
		var next_index := -1
		for index in range(next_nodes.size()):
			if next_nodes[index].get("name") == previous_node.get("name"):
				next_index = index
				break
		if next_index < 0:
			continue
		var next_node: Dictionary = next_nodes[next_index]
		if previous_node.get("type") != next_node.get("type"):
			continue
		var node_name := str(previous_node.get("name", ""))
		var child_path := node_name if parent_path.is_empty() else parent_path + "/" + node_name
		if previous_node.get("type") == "graph":
			_extract_leaf_update_actions(previous_node, next_node, child_path, undo_actions, redo_actions)
		elif previous_node.get("type") not in ["remote", "ios", "portal"] and previous_node.hash() != next_node.hash():
			undo_actions.push_back({"type": "update_generator", "parent": parent_path, "name": node_name, "data": previous_node.duplicate(true)})
			redo_actions.push_back({"type": "update_generator", "parent": parent_path, "name": node_name, "data": next_node.duplicate(true)})
			next_nodes[next_index] = previous_node.duplicate(true)
	next.nodes = next_nodes

func _restore_graph(graph, serialized: Dictionary) -> bool:
	var loader = graph.get_node_or_null("/root/mm_loader")
	if loader == null or !loader.has_method("create_gen"):
		return false
	var restored = await loader.create_gen(serialized)
	if restored == null:
		return false
	var previous_need_save: bool = graph.need_save
	var previous_recovery_state: bool = graph.need_save_crash_recovery
	var previous_top = graph.top_generator
	if previous_top != null:
		graph.remove_child(previous_top)
		previous_top.free()
	graph.top_generator = restored
	graph.add_child(restored)
	graph.move_child(restored, 0)
	graph.update_view(restored)
	graph.set_need_save(previous_need_save)
	graph.need_save_crash_recovery = previous_recovery_state
	return true

func undo(params: Dictionary):
	var graph = _current_graph()
	if graph == null:
		return _error(-32004, "PROJECT_NOT_FOUND")
	if params.get("expectedRevision", -1) != _revision(graph):
		return _error(-32010, "REVISION_CONFLICT")
	if !graph.undoredo.can_undo():
		return _error(-32602, "No transaction to undo")
	graph.undoredo.undo()
	_revisions[graph.get_instance_id()] = _revision(graph) + 1
	return get_graph_snapshot({})

func redo(params: Dictionary):
	var graph = _current_graph()
	if graph == null:
		return _error(-32004, "PROJECT_NOT_FOUND")
	if params.get("expectedRevision", -1) != _revision(graph):
		return _error(-32010, "REVISION_CONFLICT")
	if !graph.undoredo.can_redo():
		return _error(-32602, "No transaction to redo")
	graph.undoredo.redo()
	_revisions[graph.get_instance_id()] = _revision(graph) + 1
	return get_graph_snapshot({})

func render_node_output(params: Dictionary):
	var graph = _current_graph()
	if graph == null:
		return _error(-32004, "PROJECT_NOT_FOUND")
	if params.get("projectId") != _active_project_id():
		return _error(-32004, "PROJECT_NOT_FOUND")
	var native := _resolve_native(params.get("nodeId", ""), {})
	if !graph.generator.has_node(native):
		return _error(-32011, "NODE_NOT_FOUND")
	var generator = graph.generator.get_node(native)
	var output_port := _port_index(generator.get_output_defs(true), params.get("outputPort", 0))
	if output_port < 0:
		return _error(-32012, "PORT_NOT_FOUND")
	var resolution: int = int(params.get("resolution", 64))
	if resolution < 16 or resolution > 1024:
		return _error(-32602, "Preview resolution must be between 16 and 1024")
	var image: Image = await generator.render_output(output_port, Vector2i(resolution, resolution))
	if image == null or image.is_empty():
		return _error(-32020, "Preview render returned no image")
	var png := image.save_png_to_buffer()
	if png.is_empty():
		return _error(-32020, "Preview PNG encoding failed")
	if png.size() > 6 * 1024 * 1024:
		return _error(-32021, "Preview exceeds the bridge response limit")
	return {
		"mimeType": "image/png",
		"data": Marshalls.raw_to_base64(png),
		"width": image.get_width(),
		"height": image.get_height()
	}

func _apply_operation(graph, operation: Dictionary, temporary_native_ids: Dictionary, temporary_ids: Dictionary, changed: Array):
	var type: String = operation.get("type", "")
	match type:
		"node.create":
			var data := {
				"type": operation.get("nodeTypeId", ""),
				"parameters": operation.get("parameters", {}).duplicate(true),
				"node_position": operation.get("position", {"x": 0, "y": 0})
			}
			if operation.has("comment"):
				var comment: Dictionary = operation.comment
				data.title = str(comment.get("title", "Comment"))
				data.text = str(comment.get("text", ""))
				var comment_size: Dictionary = comment.get("size", {})
				data.size = {
					"x": float(comment_size.get("width", 420)),
					"y": float(comment_size.get("height", 240))
				}
			if operation.has("remoteControls"):
				var widgets: Array = []
				for control in operation.remoteControls:
					var linked_widgets: Array = []
					var links: Array = control.get("links", [])
					for link in links:
						linked_widgets.append({
							"node": _resolve_native(link.get("nodeId", ""), temporary_native_ids),
							"widget": str(link.get("parameter", ""))
						})
					if !links.is_empty():
						var first_link: Dictionary = links[0]
						var first_native := _resolve_native(first_link.get("nodeId", ""), temporary_native_ids)
						var first_parameter := str(first_link.get("parameter", ""))
						if graph.generator.has_node(first_native):
							var target_generator = graph.generator.get_node(first_native)
							if target_generator.parameters.has(first_parameter):
								data.parameters[str(control.get("name", ""))] = target_generator.get_parameter(first_parameter)
					widgets.append({
						"name": str(control.get("name", "")),
						"label": str(control.get("label", "")),
						"shortdesc": str(control.get("label", "")),
						"longdesc": str(control.get("description", "")),
						"type": "linked_control",
						"linked_widgets": linked_widgets
					})
				data.widgets = widgets
			var nodes: Array = await graph.do_create_nodes(data, Vector2.ZERO)
			if nodes.is_empty():
				return _error(-32020, "Could not create node")
			var node = nodes[0]
			var stable := _node_id(graph, node.generator.name)
			if operation.has("tempId"):
				temporary_native_ids[operation.tempId] = node.generator.name
				temporary_ids[operation.tempId] = stable
			changed.append(stable)
		"node.delete":
			var native := _resolve_native(operation.get("nodeId", ""), temporary_native_ids)
			var view_name := "node_" + native
			if !graph.has_node(view_name):
				return _error(-32011, "NODE_NOT_FOUND")
			var view = graph.get_node(view_name)
			if !view.generator.can_be_deleted():
				return _error(-32602, "NODE_NOT_DELETABLE", {"nodeId": operation.get("nodeId", ""), "nativeId": native})
			if operation.get("cascade", "reject") == "reject":
				for connection in graph.generator.connections:
					if connection.from == native or connection.to == native:
						return _error(-32602, "Node is connected; use cascade=disconnect")
			graph.do_remove_node(view)
			if graph.generator.has_node(native):
				return _error(-32020, "Node deletion did not change the native graph")
			changed.append(_node_id(graph, native))
		"node.set_parameter":
			var native := _resolve_native(operation.get("nodeId", ""), temporary_native_ids)
			if !graph.generator.has_node(native):
				return _error(-32011, "NODE_NOT_FOUND")
			var generator = graph.generator.get_node(native)
			var parameter_name: String = operation.get("parameter", "")
			if generator.get_parameter_def(parameter_name).is_empty() and !generator.parameters.has(parameter_name):
				return _error(-32602, "INVALID_PARAMETER", {"nodeId": operation.get("nodeId", ""), "parameter": parameter_name})
			generator.set_parameter(parameter_name, _deserialize_native_parameter(operation.get("value")))
			changed.append(_node_id(graph, native))
		"node.move":
			var native := _resolve_native(operation.get("nodeId", ""), temporary_native_ids)
			var view_name := "node_" + native
			if !graph.has_node(view_name):
				return _error(-32011, "NODE_NOT_FOUND")
			var position: Dictionary = operation.get("position", {})
			graph.get_node(view_name).position_offset = Vector2(position.get("x", 0), position.get("y", 0))
		"connection.create":
			var from_native := _resolve_native(operation.get("fromNodeId", ""), temporary_native_ids)
			var to_native := _resolve_native(operation.get("toNodeId", ""), temporary_native_ids)
			if !graph.generator.has_node(from_native) or !graph.generator.has_node(to_native):
				return _error(-32011, "NODE_NOT_FOUND")
			var from_generator = graph.generator.get_node(from_native)
			var to_generator = graph.generator.get_node(to_native)
			var from_port := _port_index(from_generator.get_output_defs(), operation.get("fromPort", 0))
			var to_port := _port_index(to_generator.get_input_defs(), operation.get("toPort", 0))
			if from_port < 0 or to_port < 0:
				return _error(-32012, "PORT_NOT_FOUND")
			if !graph.do_connect_node("node_" + from_native, from_port, "node_" + to_native, to_port):
				return _error(-32013, "PORT_TYPE_MISMATCH")
			for index in graph.generator.connections.size():
				var created_connection: Dictionary = graph.generator.connections[index]
				if created_connection.from == from_native and int(created_connection.from_port) == from_port and created_connection.to == to_native and int(created_connection.to_port) == to_port:
					var created_id := _connection_id(index, created_connection)
					changed.append(created_id)
					if operation.has("tempId"):
						temporary_ids[operation.tempId] = created_id
					break
		"connection.delete":
			var requested_id: String = operation.get("connectionId", "")
			var native_selector: Dictionary = operation.get("nativeConnection", {})
			for index in graph.generator.connections.size():
				var connection: Dictionary = graph.generator.connections[index]
				var native_match := !native_selector.is_empty() and str(native_selector.get("from", "")) == str(connection.from) and int(native_selector.get("fromPort", -1)) == int(connection.from_port) and str(native_selector.get("to", "")) == str(connection.to) and int(native_selector.get("toPort", -1)) == int(connection.to_port)
				if native_match or _connection_id(index, connection) == requested_id:
					if !graph.do_disconnect_node("node_" + connection.from, connection.from_port, "node_" + connection.to, connection.to_port):
						return _error(-32020, "Could not disconnect nodes")
					changed.append(_connection_id(index, connection))
					return null
			return _error(-32014, "CONNECTION_NOT_FOUND")
		"selection.set":
			var selection_error = _set_selection(graph, operation.get("nodeIds", []), temporary_native_ids)
			if selection_error != null:
				return selection_error
		_:
			return _error(-32602, "Unsupported graph operation: " + type)
	return null

func _structurally_valid(graph) -> bool:
	if graph.top_generator == null:
		return false
	var serialized = graph.top_generator.serialize()
	return serialized.has("nodes") and serialized.has("connections")

func _serialize_graph(generator) -> Dictionary:
	return _normalize_serialized_graph(generator.serialize().duplicate(true))

func _normalize_serialized_graph(value: Dictionary) -> Dictionary:
	var result := value.duplicate(true)
	var normalized_nodes: Array = []
	for node in result.get("nodes", []):
		if node is Dictionary and node.has("nodes"):
			normalized_nodes.append(_normalize_serialized_graph(node))
		else:
			normalized_nodes.append(node.duplicate(true) if node is Dictionary else node)
	normalized_nodes.sort_custom(Callable(self, "_compare_serialized_nodes"))
	result["nodes"] = normalized_nodes

	var normalized_connections: Array = []
	var raw_connections = result.get("connections", [])
	if raw_connections is Array:
		for connection in raw_connections:
			normalized_connections.append(connection.duplicate(true))
	elif raw_connections is Dictionary:
		for target in raw_connections.keys():
			var target_ports: Dictionary = raw_connections[target]
			for target_port in target_ports.keys():
				var source: Dictionary = target_ports[target_port]
				normalized_connections.append({
					"from": source.get("from", source.get("node", "")),
					"from_port": int(source.get("from_port", source.get("port", 0))),
					"to": str(target),
					"to_port": int(target_port)
				})
	normalized_connections.sort_custom(Callable(self, "_compare_serialized_connections"))
	result["connections"] = normalized_connections
	return result

func _compare_serialized_nodes(left: Dictionary, right: Dictionary) -> bool:
	var left_key := "%s:%s" % [left.get("name", ""), left.get("type", "")]
	var right_key := "%s:%s" % [right.get("name", ""), right.get("type", "")]
	return left_key < right_key

func _compare_serialized_connections(left: Dictionary, right: Dictionary) -> bool:
	var left_key := "%s:%010d:%s:%010d" % [left.get("to", ""), int(left.get("to_port", 0)), left.get("from", ""), int(left.get("from_port", 0))]
	var right_key := "%s:%010d:%s:%010d" % [right.get("to", ""), int(right.get("to_port", 0)), right.get("from", ""), int(right.get("from_port", 0))]
	return left_key < right_key

func _main_window():
	var globals = get_node_or_null("/root/mm_globals")
	if globals != null and "main_window" in globals:
		return globals.main_window
	return get_tree().root.find_child("MainWindow", true, false)

func _current_graph():
	var main = _main_window()
	return main.get_current_graph_edit() if main != null and main.has_method("get_current_graph_edit") else null

func _current_project():
	var main = _main_window()
	return main.get_current_project() if main != null and main.has_method("get_current_project") else null

func _is_root_graph(graph) -> bool:
	return graph != null and graph.generator == graph.top_generator

func _current_project_type() -> String:
	var main = _main_window()
	return main.get_current_mode() if main != null and main.has_method("get_current_mode") else "unknown"

func _project_id(project) -> String:
	if project.has_meta("materialpilot_project_id"):
		return str(project.get_meta("materialpilot_project_id"))
	var basis := str(project.get_instance_id())
	if "save_path" in project and !project.save_path.is_empty():
		basis = project.save_path
	var project_id := "mmpr_native_" + basis.sha256_text().left(16)
	project.set_meta("materialpilot_project_id", project_id)
	return project_id

func _active_project_id() -> String:
	var project = _current_project()
	if project == null:
		return ""
	return _project_id(project)

func _node_id(graph, native_name: String) -> String:
	return _stable_native_id("mmn", _active_project_id(), native_name)

func _connection_id(_index: int, connection: Dictionary) -> String:
	var native_id := "%s:%d:%s:%d" % [connection.from, connection.from_port, connection.to, connection.to_port]
	return _stable_native_id("mmc", _active_project_id(), native_id)

func _stable_native_id(prefix: String, project_id: String, native_id: String) -> String:
	var bytes := project_id.to_utf8_buffer()
	bytes.append(0)
	bytes.append_array(native_id.to_utf8_buffer())
	var hash_value: int = 0x811c9dc5
	for byte in bytes:
		hash_value = int((hash_value ^ int(byte)) * 0x01000193) & 0xffffffff
	return "%s_native_%08x" % [prefix, hash_value]

func _hash_value(value) -> String:
	return JSON.stringify(_canonicalize(value)).sha256_text()

func _graph_hash(value: Dictionary) -> String:
	var semantic_graph := _normalize_serialized_graph(value)
	semantic_graph.erase("name")
	return _hash_value(semantic_graph)

func _canonicalize(value):
	if typeof(value) == TYPE_FLOAT and value == 0.0:
		return 0
	if value is Dictionary:
		var keys: Array = value.keys()
		keys.sort()
		var result := {}
		for key in keys:
			result[key] = _canonicalize(value[key])
		return result
	if value is Array:
		var result := []
		for entry in value:
			result.append(_canonicalize(entry))
		return result
	return value

func _revision(graph) -> int:
	return int(_revisions.get(graph.get_instance_id(), 0))

func _project_summary(project, active: bool) -> Dictionary:
	var graph = project.get_graph_edit() if project != null and project.has_method("get_graph_edit") else null
	var project_name := str(project.get_meta("materialpilot_project_name", project.name))
	return {
		"id": _project_id(project),
		"type": project.get_project_type() if project.has_method("get_project_type") else "unknown",
		"name": project_name,
		"path": project.save_path if "save_path" in project else null,
		"revision": _revision(graph) if graph != null else 0,
		"dirty": graph.need_save if graph != null and "need_save" in graph else false,
		"active": active
	}

func render_material_3d(params: Dictionary):
	var graph = _current_graph()
	var main = _main_window()
	if graph == null or main == null or params.get("projectId") != _active_project_id():
		return _error(-32004, "PROJECT_NOT_FOUND")
	if !("preview_3d" in main) or main.preview_3d == null:
		return _error(-32030, "CAPABILITY_NOT_AVAILABLE")
	var geometry := str(params.get("geometry", ""))
	var model_name := "Sphere" if geometry == "sphere" else "Plane" if geometry == "plane" else ""
	if model_name.is_empty():
		return _error(-32602, "Geometry must be sphere or plane")
	var resolution := int(params.get("resolution", 1024))
	if resolution < 64 or resolution > 2048:
		return _error(-32602, "3D preview resolution must be between 64 and 2048")
	var preview = main.preview_3d
	var previous_model: int = preview.current_object.get_index()
	var viewport = preview.get_node_or_null("MaterialPreview")
	if viewport == null or !(viewport is SubViewport):
		return _error(-32030, "CAPABILITY_NOT_AVAILABLE")
	var previous_size: Vector2i = viewport.size
	var previous_stretch: bool = preview.stretch
	if !await _wait_for_preview_mesh(preview.current_object):
		return _error(-32020, "The current preview geometry did not finish rendering")
	var model = preview.objects.get_node_or_null(model_name)
	if model == null:
		return _error(-32030, "CAPABILITY_NOT_AVAILABLE", {"reason": "Preview geometry is unavailable."})
	var model_id: int = model.get_index()
	var material_generator = graph.top_generator.get_node_or_null("Material")
	if material_generator == null or !material_generator.has_method("render_output"):
		return _error(-32030, "CAPABILITY_NOT_AVAILABLE", {"reason": "Material output is unavailable."})
	var output_indices := {
		"albedo": 0,
		"normal": 7,
		"ambient_occlusion": 9,
		"metallic": 12,
		"roughness": 13
	}
	var textures: Dictionary = {}
	for channel in output_indices:
		var rendered: Image = await material_generator.render_output(output_indices[channel], Vector2i(resolution, resolution))
		if rendered == null or rendered.is_empty():
			return _error(-32020, "3D preview channel render failed", {"channel": channel})
		textures[channel] = ImageTexture.create_from_image(rendered)
	var baked_material := StandardMaterial3D.new()
	baked_material.albedo_texture = textures.albedo
	baked_material.metallic = 1.0
	baked_material.metallic_texture = textures.metallic
	baked_material.metallic_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_RED
	baked_material.roughness = 1.0
	baked_material.roughness_texture = textures.roughness
	baked_material.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_RED
	baked_material.normal_enabled = true
	baked_material.normal_texture = textures.normal
	baked_material.ao_enabled = true
	baked_material.ao_texture = textures.ambient_occlusion
	baked_material.ao_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_RED
	preview.stretch = false
	viewport.size = Vector2i(resolution, resolution)
	preview.set_model(model_id)
	if !await _wait_for_preview_mesh(model):
		viewport.size = previous_size
		preview.stretch = previous_stretch
		preview.set_model(previous_model)
		return _error(-32020, "The requested preview geometry did not finish rendering")
	var previous_mesh = model.mesh
	var using_temporary_plane := false
	if geometry == "plane":
		var fallback_plane := PlaneMesh.new()
		fallback_plane.size = Vector2(2, 2)
		model.mesh = fallback_plane
		using_temporary_plane = true
	var previous_material_override = preview.current_object.material_override
	preview.current_object.material_override = baked_material
	await get_tree().process_frame
	await RenderingServer.frame_post_draw
	await get_tree().process_frame
	await RenderingServer.frame_post_draw
	var image: Image = viewport.get_texture().get_image()
	preview.current_object.material_override = previous_material_override
	if using_temporary_plane:
		model.mesh = previous_mesh
	viewport.size = previous_size
	preview.stretch = previous_stretch
	preview.set_model(previous_model)
	await _wait_for_preview_mesh(preview.current_object)
	if image == null or image.is_empty():
		return _error(-32020, "3D preview capture returned no image")
	var png := image.save_png_to_buffer()
	if png.is_empty() or png.size() > 8 * 1024 * 1024:
		return _error(-32021, "3D preview PNG exceeds the bridge response limit")
	return {
		"mimeType": "image/png",
		"data": Marshalls.raw_to_base64(png),
		"width": image.get_width(),
		"height": image.get_height()
	}

func _wait_for_preview_mesh(model) -> bool:
	if !("updating" in model):
		return true
	for _attempt in range(600):
		if !model.updating:
			return true
		await get_tree().process_frame
	return false

func export_blender(params: Dictionary):
	var graph = _current_graph()
	if graph == null or params.get("projectId") != _active_project_id():
		return _error(-32004, "PROJECT_NOT_FOUND")
	if params.get("expectedRevision", -1) != _revision(graph):
		return _error(-32010, "REVISION_CONFLICT", {"actualRevision": _revision(graph)})
	var prefix := str(params.get("prefix", "")).simplify_path()
	if !prefix.is_absolute_path() or !DirAccess.dir_exists_absolute(prefix.get_base_dir()):
		return _error(-32602, "A canonical absolute export prefix in an existing directory is required")
	var suffixes := [
		["_albedo.png", "image/png"],
		["_rough.exr", "image/x-exr"],
		["_metal.exr", "image/x-exr"],
		["_normal.png", "image/png"],
		["_displace.exr", "image/x-exr"],
		["_sss.exr", "image/x-exr"],
		["_emission.png", "image/png"],
		["_occlusion.exr", "image/x-exr"]
	]
	if !params.get("overwrite", false):
		for suffix in suffixes:
			if FileAccess.file_exists(prefix + suffix[0]):
				return _error(-32022, "OVERWRITE_NOT_ALLOWED", {"path": prefix + suffix[0]})
	var key := str(params.get("idempotencyKey", ""))
	if key.length() < 8:
		return _error(-32602, "An idempotency key is required")
	var scoped_key := _active_project_id() + ":blender-export:" + key
	var request_hash := _hash_value(params)
	if _idempotency.has(scoped_key):
		if _idempotency[scoped_key].hash != request_hash:
			return _error(-32602, "Idempotency key reused with different arguments")
		return _idempotency[scoped_key].result
	var material_node = graph.get_material_node() if graph.has_method("get_material_node") else null
	if material_node == null or !material_node.has_method("export_material"):
		return _error(-32020, "The active graph has no Blender-exportable Material node")
	var graph_before := _serialize_graph(graph.top_generator)
	var selection_before := _selection(graph)
	await material_node.export_material(prefix, "Blender", 0, true)
	var graph_after := _serialize_graph(graph.top_generator)
	if _graph_hash(graph_after) != _graph_hash(graph_before):
		if !await _restore_graph(graph, graph_before):
			return _error(-32020, "ROLLBACK_FAILED after Blender export")
		_set_selection(graph, selection_before, {})
	var artifacts: Array = []
	for suffix in suffixes:
		var path: String = prefix + suffix[0]
		if FileAccess.file_exists(path):
			var file := FileAccess.open(path, FileAccess.READ)
			if file == null:
				return _error(-32020, "Could not verify exported artifact", {"path": path})
			artifacts.append({
				"path": path,
				"mimeType": suffix[1],
				"sizeBytes": file.get_length(),
				"sha256": FileAccess.get_sha256(path)
			})
			file.close()
	if artifacts.is_empty():
		return _error(-32020, "Blender export produced no artifacts")
	_idempotency[scoped_key] = {"hash": request_hash, "result": artifacts}
	return artifacts

func _selection(graph) -> Array:
	var result: Array = []
	if graph.has_method("get_selected_nodes"):
		for node in graph.get_selected_nodes():
			result.append(_node_id(graph, node.generator.name))
	return result

func _set_selection(graph, node_ids: Array, temporary_native_ids: Dictionary):
	for child in graph.get_children():
		if child is GraphElement:
			child.selected = false
	for node_id in node_ids:
		var native := _resolve_native(node_id, temporary_native_ids)
		var view_name := "node_" + native
		if !graph.has_node(view_name):
			return _error(-32011, "NODE_NOT_FOUND")
		graph.get_node(view_name).selected = true
	return null

func _resolve_native(value: String, temporary_ids: Dictionary) -> String:
	if temporary_ids.has(value):
		return temporary_ids[value]
	if value.begins_with("mmn_native_"):
		var graph = _current_graph()
		for child in graph.generator.get_children():
			if _node_id(graph, child.name) == value:
				return child.name
	return value

func _port_index(definitions: Array, selector) -> int:
	if typeof(selector) == TYPE_INT or typeof(selector) == TYPE_FLOAT:
		return int(selector)
	var requested := str(selector).to_lower()
	for index in definitions.size():
		var definition = definitions[index]
		for field in ["name", "label", "shortdesc"]:
			if str(definition.get(field, "")).to_lower() == requested:
				return index
	return -1

func _deserialize_native_parameter(value):
	const TYPES_PATH := "res://addons/material_maker/types/types.gd"
	if ResourceLoader.exists(TYPES_PATH):
		var types = load(TYPES_PATH)
		if types != null and types.has_method("deserialize_value"):
			return types.deserialize_value(value)
	return value

func _error(code: int, message: String, data = null):
	return MaterialPilotBridgeError.new(code, message, data)
