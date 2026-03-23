import tempfile
import traceback
from cs.platform.web import JsonAPI
from cs.platform.web.root import Internal
from datetime import datetime, time, timedelta
from cdb import sqlapi
import logging
from opcua import Client, ua


class ForgeStrokeCounter(JsonAPI):
    pass


@Internal.mount(app=ForgeStrokeCounter, path="forge_stroke_counter")
def _mount_app():
    return ForgeStrokeCounter()


def Print_log(exc):
    with open(tempfile.gettempdir() + "\\opcua_log.txt", "a+") as log_file:
        log_file.write("\n" + datetime.now().strftime("%d.%m.%Y %H:%M:%S") + ":" + str(exc))
        log_file.write("\n " + traceback.format_exc())


NODE_NS1 = "ns=1;s=/HMI_DataProvider/forge_stroke_counter"
NODE_NS2 = "ns=2;s=Studio.Tags.Application.Forge_Stroke_Counter"

PRESS_CONFIG = {
    "FP2506T":  ("172.21.201.159:4840", NODE_NS1),
    "FP1001T":  ("172.21.201.161:4840", NODE_NS1),
    "FP1002T":  ("172.21.201.155:4840", NODE_NS1),
    "FP1003T":  ("172.21.201.156:4840", NODE_NS1),
    "FP1601T":  ("172.21.201.165:4840", NODE_NS1),
    "FP1602T":  ("172.21.201.160:4840", NODE_NS1),
    "FP2501T":  ("172.21.201.157:4840", NODE_NS1),
    "FP2502T":  ("172.21.201.152:48010", NODE_NS2),
    "FP2503T":  ("172.21.201.158:4840", NODE_NS1),
    "FP2505T":  ("172.21.201.151:48010", NODE_NS2),
    "FP3000T":  ("172.21.201.162:4840", NODE_NS1),
    "FP4000TA": ("172.21.201.164:4840", NODE_NS1),
    "FP4001T":  ("172.21.201.154:4840", NODE_NS1),
    "FP4002T":  ("172.21.201.153:48010", NODE_NS2),
    "FP630T":   ("172.21.201.163:4840", NODE_NS1),
    "FP1002SP": ("172.21.201.155:4840", NODE_NS1),
    "FP2507SP": (None,                  NODE_NS1),
    "FP1001SP": ("172.21.201.161:4840", NODE_NS1),
}


def get_press_config(press_name: str):
    cfg = PRESS_CONFIG.get(str(press_name))
    if cfg is None:
        return None, None
    return cfg


def read_stroke_counter(press_name: str):
    ip, node_id = get_press_config(press_name)
    if ip is None:
        Print_log(f"No IP configured for press={press_name} — skipping OPC-UA read")
        return None
    url = f"opc.tcp://{ip}"
    client = Client(url)
    try:
        client.connect()
        Print_log(f"Connected to OPC UA Server {url} — reading counter for press={press_name}")
        node = client.get_node(node_id)
        counter = int(node.get_value())
        Print_log(f"forge_stroke_counter={counter}  press={press_name}  node={node_id}")
        return counter
    except Exception as e:
        Print_log(f"Counter read failed  press={press_name}  url={url}  error={e}")
        return None
    finally:
        try:
            client.disconnect()
            Print_log(f"Disconnected from OPC UA Server {url} — press={press_name}")
        except Exception:
            pass


class ForgeStrokeCounterData:

    def __init__(self):
        self.logger = logging.getLogger(__name__)

    def get_shift(self, now=None):
        if now is None:
            now = datetime.now()
        t = now.time()
        if time(7, 30) <= t < time(15, 30):
            return 1
        if time(15, 30) <= t < time(23, 30):
            return 2
        return 3

    def get_shift_date(self, now=None):
        if now is None:
            now = datetime.now()
        shift = self.get_shift(now)
        today = now.date()
        if shift == 3 and now.time() < time(7, 30):
            return today - timedelta(days=1)
        return today

    def get_live_counter(self, press_name: str) -> dict:
        ip, _ = get_press_config(press_name)
        if press_name not in PRESS_CONFIG:
            return {"status": "error", "press": press_name, "message": f"Unknown press '{press_name}'."}
        if ip is None:
            return {"status": "error", "press": press_name, "message": f"No IP configured for '{press_name}'."}
        counter_value = read_stroke_counter(press_name)
        if counter_value is None:
            return {"status": "error", "press": press_name, "message": "Could not read counter from HMI."}
        return {"status": "ok", "press": press_name, "forge_stroke_counter": counter_value}

    def get_previous_die_info(self, press_name: str) -> dict:
        now = datetime.now()
        shift = self.get_shift(now)
        shift_date = self.get_shift_date(now)

        sql = (
            "SELECT TOP 1 cdb_object_id, die_number, plant_code, net_wt, created_at "
            "FROM kln_die_selection "
            "WHERE forge_press = '" + str(press_name) + "' "
            "AND shift = " + str(shift) + " "
            "AND CAST(created_at AS DATE) = '" + str(shift_date) + "' "
            "ORDER BY created_at DESC"
        )
        rs = sqlapi.RecordSet2(sql=sql)
        if not rs:
            return {"status": "no_previous_die", "message": "No previous die found."}

        row = rs[0]
        created_at = row["created_at"]
        if hasattr(created_at, "strftime"):
            created_at = created_at.strftime("%Y-%m-%d %H:%M:%S")

        return {
            "status":        "ok",
            "cdb_object_id": row["cdb_object_id"],
            "die_number":    row["die_number"],
            "plant_code":    row["plant_code"],
            "net_wt":        row["net_wt"],
            "created_at":    created_at,
        }


@ForgeStrokeCounter.path(model=ForgeStrokeCounterData, path="")
def _path():
    return ForgeStrokeCounterData()


@ForgeStrokeCounter.json(model=ForgeStrokeCounterData, request_method="GET")
def _get_counter(model, request):
    try:
        press = request.params.get("press")
        if not press:
            return {"status": "error", "message": "press parameter is required"}
        return model.get_live_counter(press)
    except Exception as e:
        model.logger.error(f"GET forge_stroke_counter error: {e}")
        return {"status": "error", "message": str(e)}


@ForgeStrokeCounter.json(model=ForgeStrokeCounterData, request_method="POST")
def _get_previous_die(model, request):
    """
    POST /internal/forge_stroke_counter
    Body: { "press": "<press_name>" }
    Returns previous die info so frontend can do the PUT itself.
    """
    try:
        body = request.json
        if not body or not body.get("press"):
            return {"status": "error", "message": "press field is required"}
        return model.get_previous_die_info(body["press"])
    except Exception as e:
        model.logger.error(f"POST forge_stroke_counter error: {e}")
        return {"status": "error", "message": str(e)}