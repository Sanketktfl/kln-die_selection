import tempfile
import traceback
from cs.platform.web import JsonAPI
from cs.platform.web.root import Internal
from datetime import datetime,time
from cdb import sqlapi
from typing import Dict, Any
import logging

class StrokeSelection(JsonAPI):
    pass

@Internal.mount(app=StrokeSelection, path="stroke_selection")
def _mount_app():
    return StrokeSelection()


class StrokeSelectionData:

    def __init__(self):
        self.logger = logging.getLogger(__name__)

    def get_die_data(self, filters=None):
        filters = filters or {}

        plant_code = 7026

        sqldata = """
            SELECT die_number, cut_wt, forge_stroke_selection,
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
            net_wt = None

            try:
                sap_rs = sqlapi.RecordSet2(sql=sap_sql)

                for row in sap_rs:
                    net_wt = row["net_wt"]
                    break

            except Exception as e:
                self.logger.error(str(e))

            row_dict = {col: record[col] for col in record.keys()}

            # override net_wt with SAP value
            row_dict["net_wt"] = net_wt

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