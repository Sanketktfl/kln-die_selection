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

class StrokeSelectionData:

    def __init__(self):
        self.logger = logging.getLogger(__name__)

    def get_die_data(self,filters=None):
        filters = filters or {}

        plant_code = 7001
        sqldata=("SELECT die_number,net_wt,cut_wt,forge_stroke_selection,trim_stroke_selection,plant_code "
                 "FROM kln_master_data")

        sqldata += f" WHERE 1=1 "
        if filters.get('die_number'):
            die_number = filters['die_number']
            sqldata+=f""" AND die_number = '{die_number}'"""
        if plant_code:
            sqldata+=f""" AND plant_code = {plant_code}"""
        recordset=sqlapi.RecordSet2(sql=sqldata)
        data = []
        for record in recordset:
            row_dict = {col: record[col] for col in record.keys()}
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