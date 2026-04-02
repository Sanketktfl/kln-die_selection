# Fetches data from master data and save to die selection

import tempfile
import traceback
from cs.platform.web import JsonAPI
from cs.platform.web.root import Internal
from datetime import datetime,time
from cdb import sqlapi
from typing import Dict, Any
import logging
from opcua import Client,ua

class StrokeSelection(JsonAPI):
    pass

@Internal.mount(app=StrokeSelection, path="stroke_selection")
def _mount_app():
    return StrokeSelection()


def Print_log(exc):
    with open(tempfile.gettempdir() + "\\opcua_log.txt", "a+") as log_file:
        log_file.write("\n" + datetime.now().strftime("%d.%m.%Y %H:%M:%S") + ":" + str(exc))
        log_file.write("\n " + traceback.format_exc())

OPC_TAG_CONFIG = {
    "NS1": {
        "run_code":  "ns=1;s=/HMI_DataProvider/run_code",
        "heat_code": "ns=1;s=/HMI_DataProvider/heat_code",
    },
    "NS2": {
        "run_code":  "ns=2;s=Studio.Tags.Application.Run_Code",
        "heat_code": "ns=2;s=Studio.Tags.Application.Heat_Code",
    }
}

NS1_PRESSES = ["4001","1002","1003","2501","2503","2506","1001","630","1602","3000","1601","4000"]
NS2_PRESSES = ["2505","2502","4002"]

PRESS_CONFIG = {
    "FP2506T":  "172.21.201.159:4840",
    "FP1001T":  "172.21.201.161:4840",
    "FP1002T":  "172.21.201.155:4840",
    "FP1003T":  "172.21.201.156:4840",
    "FP1601T":  "172.21.201.165:4840",
    "FP1602T":  "172.21.201.160:4840",
    "FP2501T":  "172.21.201.157:4840",
    "FP2502T":  "172.21.201.152:48010",
    "FP2503T":  "172.21.201.158:4840",
    "FP2505T":  "172.21.201.151:48010",
    "FP3000T":  "172.21.201.162:4840",
    "FP4000TA": "172.21.201.164:4840",
    "FP4001T":  "172.21.201.154:4840",
    "FP4002T":  "172.21.201.153:48010",
    "FP630T":   "172.21.201.163:4840",
    "FP1002SP": "172.21.201.155:4840",
    "FP2507SP": None,
    "FP1001SP": "172.21.201.161:4840",
}

def get_opc_tag_group(press_name: str):
    press = ''.join(filter(str.isdigit, str(press_name)))
    if press in NS1_PRESSES:
        return OPC_TAG_CONFIG["NS1"]
    elif press in NS2_PRESSES:
        return OPC_TAG_CONFIG["NS2"]
    return None

class StrokeSelectionData:

    def __init__(self):
        self.logger = logging.getLogger(__name__)

    def get_die_data(self, filters=None):
        filters = filters or {}

        plant_code = 7026

        sqldata = """
            SELECT die_number, forge_stroke_selection,
                   trim_stroke_selection, plant_code
            FROM kln_master_data
            WHERE 1=1
        """

        if filters.get('die_number'):
            die_number = filters['die_number']
            sqldata += f" AND die_number = '{die_number}'"

        if plant_code:
            sqldata += f" AND plant_code = {plant_code}"

        recordset = sqlapi.RecordSet2(sql=sqldata)

        data = []

        for record in recordset:

            die_number = str(record["die_number"])

            # Ensure die_number is 5 digits
            die_number_5 = die_number.zfill(5)

            # SAP OPENQUERY for net weight
            sap_sql = f"""
            SELECT net_wt
            FROM openquery([KTFLSQLDB.KALYANICORP.COM],
            'select top 1 ntgew as net_wt
            from zmm60
            where werks=''2002''
            and matnr like ''WFFOR%''
            and bismt=''{die_number_5}''
            order by laeda desc')
            """
            sap_sql2 = f"""
                        SELECT cut_wt
                        FROM openquery([KTFLSQLDB.KALYANICORP.COM],
                        'select top 1 ntgew as cut_wt
                        from zmm60
                        where werks=''2002''
                        and matnr like ''WFCTB%''
                        and bismt=''{die_number_5}''
                        order by laeda desc')
                        """
            net_wt = None
            cut_wt = None

            try:
                sap_rs = sqlapi.RecordSet2(sql=sap_sql)

                for row in sap_rs:
                    net_wt = row["net_wt"]
                    break

                sap_rs2 = sqlapi.RecordSet2(sql=sap_sql2)

                for row in sap_rs2:
                    cut_wt = row["cut_wt"]
                    break

            except Exception as e:
                self.logger.error(str(e))

            row_dict = {col: record[col] for col in record.keys()}

            # override net_wt with SAP value
            row_dict["net_wt"] = net_wt
            row_dict["cut_wt"] = cut_wt

            data.append(row_dict)

        return data

    def get_shift(self, now=None):
        if now is None:
            now = datetime.now()

        current_time = now.time()

        shift1_start = time(7, 30)
        shift1_end = time(15, 30)

        shift2_start = time(15, 30)
        shift2_end = time(23, 30)

        shift3_start = time(23, 30)
        shift3_end = time(7, 30)  # Next day

        if shift1_start <= current_time < shift1_end:
            return 1
        elif shift2_start <= current_time < shift2_end:
            return 2
        else:
            return 3  # Covers 23:30 → 07:30


    def create_die_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        try:
            die_number = data.get("die_number")
            plant_code = data.get("plant_code")
            forge_press = data.get("forge_press")
            heat_code = data.get("heat_code")
            run_code = data.get("run_code")

            now = datetime.now()
            shift = self.get_shift(now)
            created = now.date()   # YYYY-MM-DD

            # 🔥 FIXED SQL SERVER DATE COMPARISON
            sql_check = f"""
                SELECT cdb_object_id 
                FROM kln_die_selection
                WHERE die_number = '{die_number}'
                  AND plant_code = {plant_code}
                  AND forge_press = '{forge_press}'
                  AND shift = {shift}
                  AND CAST(created_at AS DATE) = '{created}'
            """

            recordset = sqlapi.RecordSet2(sql=sql_check)

            if recordset:
                return {
                    "status": "already_saved",
                    "message": "Record already exists",
                    "cdb_object_id": recordset[0]["cdb_object_id"]
                }

            record = sqlapi.Record("kln_die_selection")
            record["die_number"] = die_number
            record["plant_code"] = plant_code
            record["forge_press"] = forge_press
            record["cut_wt"] = data.get("cut_wt")
            record["net_wt"] = data.get("net_wt")
            record["forge_stroke_selection"] = data.get("forge_stroke_selection")
            record["trim_stroke_selection"] = data.get("trim_stroke_selection")
            record["created_at"] = now
            record["shift"] = shift
            record["heat_code"] = heat_code
            record["run_code"] = run_code
            record.insert()

            # opcua logic
            client = Client("opc.tcp://172.21.204.30:4840")
            try:
                # OPC UA Server URL (replace with your server endpoint)

                # If authentication is required
                # client.set_user("username")
                # client.set_password("password")

                client.connect()
                Print_log("Connected to OPC UA Server")

                # Example: Read a variable node
                node = client.get_node("ns=1;s=/HMI_DataProvider/kpi/die_number")  # your node ID
                # value = node.get_value()
                # Print_log(value)
                die_no = int(die_number)
                ua_value = ua.Variant(die_no, ua.VariantType.UInt16)
                node.set_value(ua_value)

                # FORGE STROKE (UInt16)
                forge_node = client.get_node("ns=1;s=/HMI_DataProvider/fp/fp_stroke_selection")

                forge_val = data.get("forge_stroke_selection")
                if forge_val is None or forge_val == "":
                    forge_val = 0  # default value
                forge_stroke = int(forge_val)
                if not (0 <= forge_stroke <= 65535):
                    raise ValueError(f"forge_stroke_selection {forge_stroke} out of Int16 range")
                forge_variant = ua.Variant(forge_stroke, ua.VariantType.Int16)
                forge_node.set_value(forge_variant)
                Print_log(f"Written forge_stroke_selection: {forge_stroke}")

                # TRIM STROKE (UInt16)
                trim_node = client.get_node("ns=1;s=/HMI_DataProvider/tp/tp_stroke_selection")
                trim_val = data.get("trim_stroke_selection")
                if trim_val is None or trim_val == "":
                    trim_val = 0  # default value
                trim_stroke = int(trim_val)
                if not (0 <= trim_stroke <= 65535):
                    raise ValueError(f"trim_stroke_selection {trim_stroke} out of Int16 range")
                trim_variant = ua.Variant(trim_stroke, ua.VariantType.Int16)
                trim_node.set_value(trim_variant)
                Print_log(f"Written trim_stroke_selection: {trim_stroke}")

                # CUT WEIGHT (Float)
                cut_node = client.get_node("ns=1;s=/HMI_DataProvider/kpi/cut_weight")
                cut_val = data.get("cut_wt")
                if cut_val is None or cut_val == "":
                    cut_val = 0.0
                cut_float = float(cut_val)
                cut_variant = ua.Variant(cut_float, ua.VariantType.Float)
                cut_node.set_value(cut_variant)
                Print_log(f"Written cut_weight: {cut_float}")

                # NET WEIGHT (Float)
                net_node = client.get_node("ns=1;s=/HMI_DataProvider/kpi/net_weight")
                net_val = data.get("net_wt")
                if net_val is None or net_val == "":
                    net_val = 0.0
                net_float = float(net_val)
                net_variant = ua.Variant(net_float, ua.VariantType.Float)
                net_node.set_value(net_variant)
                Print_log(f"Written net_weight: {net_float}")

            except Exception as e:
                Print_log(e)

            finally:
                client.disconnect()
                Print_log("Disconnected from OPC UA Server")

            # ── Write heat_code & run_code to per-press HMI ──────────────────
            press_ip = PRESS_CONFIG.get(str(forge_press))

            if press_ip:
                tag_group = get_opc_tag_group(forge_press)
                if tag_group:
                    hc_client = Client(f"opc.tcp://{press_ip}")
                    try:
                        hc_client.connect()
                        Print_log(f"Connected to press HMI {press_ip} for heat/run code write")

                        run_val = str(run_code) if run_code else "NA"
                        heat_val = str(heat_code) if heat_code else "NA"

                        hc_client.get_node(tag_group["run_code"]).set_value(
                            ua.Variant(run_val, ua.VariantType.String)
                        )
                        Print_log(f"Written run_code={run_val} to press={forge_press}")

                        hc_client.get_node(tag_group["heat_code"]).set_value(
                            ua.Variant(heat_val, ua.VariantType.String)
                        )
                        Print_log(f"Written heat_code={heat_val} to press={forge_press}")

                    except Exception as e:
                        Print_log(f"heat/run OPC write failed press={forge_press}: {e}")
                    finally:
                        try:
                            hc_client.disconnect()
                            Print_log(f"Disconnected press HMI {press_ip}")
                        except Exception:
                            pass
                else:
                    Print_log(f"No OPC tag group found for press={forge_press} — skipping heat/run write")
            else:
                Print_log(f"No IP configured for press={forge_press} — skipping heat/run write")

            return {
                "status": "created",
                "message": "Record inserted successfully",
                "cdb_object_id": record["cdb_object_id"],
                "shift": shift,
                "created_at": now.strftime("%Y-%m-%d %H:%M:%S"),
            }

        except Exception as e:
            return {"status": "error", "message": f"Failed to save item: {str(e)}"}


@StrokeSelection.path(model=StrokeSelectionData, path="")
def _path():
    return StrokeSelectionData()

@StrokeSelection.json(model=StrokeSelectionData,request_method="GET")
def _get_items(model, request):
    """GET endpoint for retrieving production items"""
    try:
        filters = {}
        # Extract and sanitize query parameters
        if request.params.get('die_number'):
            filters['die_number'] = request.params.get('die_number')
        if request.params.get('plant_code'):
            filters['plant_code'] = request.params.get('plant_code')

        return model.get_die_data(filters)
    except Exception as e:
        model.logger.error(f"Error in GET endpoint: {str(e)}")
        return {"message": "Failed to retrieve items"}


@StrokeSelection.json(model=StrokeSelectionData,request_method="POST")
def _create_item(model, request):
    """GET endpoint for retrieving production items"""
    try:
        incoming_data = request.json
        if not incoming_data:
            return {"message": "No data provided"}

        model.logger.info(f"Creating new item: {incoming_data.get('die_number', 'Unknown')}")
        return model.create_die_data(incoming_data)
    except Exception as e:
        model.logger.error(f"Error in POST endpoint: {str(e)}")
        return {"message": "Failed to create item"}