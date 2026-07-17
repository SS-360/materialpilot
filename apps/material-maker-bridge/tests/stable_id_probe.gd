extends SceneTree

func _init() -> void:
	var project_id := "mmpr_native_20fd51dafc891528"
	var actual := _stable_native_id("mmn", project_id, "colorize")
	if actual != "mmn_native_e01cce9a":
		push_error("Stable ID mismatch: " + actual)
		quit(1)
		return
	print("Stable ID contract passed: " + actual)
	quit(0)

func _stable_native_id(prefix: String, project_id: String, native_id: String) -> String:
	var bytes := project_id.to_utf8_buffer()
	bytes.append(0)
	bytes.append_array(native_id.to_utf8_buffer())
	var hash_value: int = 0x811c9dc5
	for byte in bytes:
		hash_value = int((hash_value ^ int(byte)) * 0x01000193) & 0xffffffff
	return "%s_native_%08x" % [prefix, hash_value]
