# 火星中继站事故包

`incident.json` 是 fake 与真实 DeepSeek 演示共用的固定离线输入。CLI 在启动时验证它的结构，然后只把内容交给无参数的 `read_incident_packet` 工具；模型不会获得文件路径、通用读取工具或 Shell。

教程的唯一正确恢复结果是：隔离 `RELAY-7`，选择 `ASTER`，原因为 `THERMAL_DRIFT`。
