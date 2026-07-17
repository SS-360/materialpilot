class_name MaterialPilotBridgeError
extends RefCounted

var rpc_code: int
var message: String
var data

func _init(p_code: int, p_message: String, p_data = null) -> void:
	rpc_code = p_code
	message = p_message
	data = p_data

