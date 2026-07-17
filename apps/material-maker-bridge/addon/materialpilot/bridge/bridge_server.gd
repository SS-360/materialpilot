extends Node

const PROTOCOL_VERSION := "1.0"
const BRIDGE_VERSION := "0.1.0"
const PORT_START := 39100
const PORT_END := 39200
const MAX_PAYLOAD_BYTES := 8 * 1024 * 1024

var _tcp_server := TCPServer.new()
var _peers: Array[Dictionary] = []
var _token := ""
var _instance_id := ""
var _port := 0
var _runtime_file := ""
var _adapter: Node

func _ready() -> void:
	_adapter = preload("../adapters/material_maker_adapter.gd").new()
	add_child(_adapter)
	_token = Crypto.new().generate_random_bytes(32).hex_encode()
	_instance_id = "mmi_" + Crypto.new().generate_random_bytes(16).hex_encode()
	for candidate in range(PORT_START, PORT_END):
		if _tcp_server.listen(candidate, "127.0.0.1") == OK:
			_port = candidate
			break
	if _port == 0:
		push_error("MaterialPilot could not bind a loopback bridge port")
		return
	_runtime_file = _get_runtime_file()
	_write_runtime_record()
	set_process(true)

func _exit_tree() -> void:
	_tcp_server.stop()
	if !_runtime_file.is_empty() and FileAccess.file_exists(_runtime_file):
		DirAccess.remove_absolute(_runtime_file)

func _process(_delta: float) -> void:
	while _tcp_server.is_connection_available():
		var stream := _tcp_server.take_connection()
		var peer := WebSocketPeer.new()
		peer.accept_stream(stream)
		_peers.append({"peer": peer, "authenticated": false})
	for index in range(_peers.size() - 1, -1, -1):
		var session: Dictionary = _peers[index]
		var peer: WebSocketPeer = session.peer
		peer.poll()
		var state := peer.get_ready_state()
		if state == WebSocketPeer.STATE_OPEN:
			while peer.get_available_packet_count() > 0:
				var packet := peer.get_packet()
				if packet.size() > MAX_PAYLOAD_BYTES:
					peer.close(1009, "Payload too large")
					break
				_handle_packet(session, packet.get_string_from_utf8())
		elif state == WebSocketPeer.STATE_CLOSED:
			_peers.remove_at(index)

func _handle_packet(session: Dictionary, text: String) -> void:
	var value = JSON.parse_string(text)
	if typeof(value) != TYPE_DICTIONARY:
		_send_error(session.peer, null, -32700, "Invalid JSON")
		return
	var request: Dictionary = value
	if request.get("jsonrpc") != "2.0" or !request.has("id") or typeof(request.get("method")) != TYPE_STRING:
		_send_error(session.peer, request.get("id"), -32600, "Invalid JSON-RPC request")
		return
	var method: String = request.method
	var params: Dictionary = request.get("params", {})
	if method == "bridge.initialize":
		_handle_initialize(session, request.id, params)
		return
	if !session.authenticated:
		_send_error(session.peer, request.id, -32001, "BRIDGE_NOT_AUTHENTICATED")
		return
	var result = await _dispatch(method, params)
	if result is MaterialPilotBridgeError:
		_send_error(session.peer, request.id, result.rpc_code, result.message, result.data)
	else:
		_send_result(session.peer, request.id, result)

func _handle_initialize(session: Dictionary, id, params: Dictionary) -> void:
	if params.get("protocolVersion") != PROTOCOL_VERSION or params.get("token") != _token:
		_send_error(session.peer, id, -32001, "BRIDGE_NOT_AUTHENTICATED")
		return
	var nonce: String = params.get("nonce", "")
	if nonce.length() < 16:
		_send_error(session.peer, id, -32602, "Handshake nonce is missing")
		return
	session.authenticated = true
	_send_result(session.peer, id, {
		"protocolVersion": PROTOCOL_VERSION,
		"bridgeVersion": BRIDGE_VERSION,
		"instanceId": _instance_id,
		"nonce": nonce,
		"materialMakerVersion": _adapter.get_material_maker_version(),
		"godotVersion": Engine.get_version_info().string,
		"projectTypes": ["material", "painting"],
		"features": _adapter.get_features(),
		"limits": {
			"maxPatchOperations": 500,
			"maxPayloadBytes": MAX_PAYLOAD_BYTES,
			"maxConcurrentJobs": 2,
			"maxPreviewResolution": 4096
		}
	})

func _dispatch(method: String, params: Dictionary):
	match method:
		"app.ping":
			return {"ok": true, "unixTime": Time.get_unix_time_from_system()}
		"app.get_status":
			return _adapter.get_status(_instance_id, BRIDGE_VERSION)
		"app.get_capabilities":
			return {"features": _adapter.get_features()}
		"project.list":
			return _adapter.list_projects()
		"project.get_active":
			return _adapter.get_active_project()
		"graph.get_snapshot":
			return _adapter.get_graph_snapshot(params)
		"graph.apply_patch":
			return await _adapter.apply_graph_patch(params)
		"graph.undo":
			return _adapter.undo(params)
		"graph.redo":
			return _adapter.redo(params)
		_:
			return MaterialPilotBridgeError.new(-32601, "Unknown bridge method: " + method)

func _send_result(peer: WebSocketPeer, id, result) -> void:
	peer.send_text(JSON.stringify({"jsonrpc": "2.0", "id": id, "result": result}))

func _send_error(peer: WebSocketPeer, id, code: int, message: String, data = null) -> void:
	var error := {"code": code, "message": message}
	if data != null:
		error.data = data
	peer.send_text(JSON.stringify({"jsonrpc": "2.0", "id": id, "error": error}))

func emit_event(method: String, params: Dictionary) -> void:
	var message := JSON.stringify({"jsonrpc": "2.0", "method": method, "params": params})
	for session in _peers:
		if session.authenticated and session.peer.get_ready_state() == WebSocketPeer.STATE_OPEN:
			session.peer.send_text(message)

func _get_runtime_file() -> String:
	var override := OS.get_environment("MATERIALPILOT_RUNTIME_DIR")
	var home := OS.get_environment("USERPROFILE") if OS.get_name() == "Windows" else OS.get_environment("HOME")
	var directory := override
	if directory.is_empty():
		directory = home.path_join(".materialpilot") if !home.is_empty() else OS.get_user_data_dir()
	DirAccess.make_dir_recursive_absolute(directory)
	return directory.path_join("bridge.json")

func _write_runtime_record() -> void:
	var file := FileAccess.open(_runtime_file, FileAccess.WRITE)
	if file == null:
		push_error("MaterialPilot could not write bridge discovery record")
		return
	file.store_string(JSON.stringify({
		"url": "ws://127.0.0.1:%d" % _port,
		"token": _token,
		"instanceId": _instance_id,
		"pid": OS.get_process_id(),
		"createdAt": Time.get_datetime_string_from_system(true) + "Z"
	}))
	file.close()
	if OS.get_name() != "Windows":
		FileAccess.set_unix_permissions(_runtime_file, 0x180)
