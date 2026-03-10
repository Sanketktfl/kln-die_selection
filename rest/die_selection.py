from cs.platform.web import JsonAPI
from cs.platform.web.root import Internal
from datetime import datetime, timedelta, time
from cdb import sqlapi, auth
from typing import Dict, Any
import logging


class DieSelection(JsonAPI):
    pass


@Internal.mount(app=DieSelection, path="die_selection")
def _mount_app():
    return DieSelection()


class DieSelectionData:

    def __init__(self):
        self.logger = logging.getLogger(__name__)

    def get_shift(self, now=None):
        if now is None:
            now = datetime.now()
        current_time = now.time()
        if time(7, 30) <= current_time < time(15, 30):
            return 1
        elif time(15, 30) <= current_time < time(23, 30):
            return 2
        else:
            return 3

    def get_previous_shift(self, shift):
        return {1: 3, 2: 1, 3: 2}[shift]

    def get_die_data(self, filters=None):
        filters = filters or {}

        sqldata = (
            "SELECT cdb_object_id, die_number, forge_press, net_wt, cut_wt, forge_stroke_selection, "
            "trim_stroke_selection, plant_code, created_at, shift "
            "FROM kln_die_selection"
        )

        if filters.get('created_at'):
            user_date = datetime.strptime(filters['created_at'], "%Y-%m-%d")
            start_datetime = user_date.replace(hour=7, minute=30, second=0)
            end_datetime = start_datetime + timedelta(days=1)

            sqldata += (
                " WHERE created_at >= '" + start_datetime.strftime("%Y-%m-%d %H:%M:%S") + "'"
                " AND created_at < '" + end_datetime.strftime("%Y-%m-%d %H:%M:%S") + "'"
            )

        recordset = sqlapi.RecordSet2(sql=sqldata)
        data = []
        for record in recordset:
            row_dict = {}
            for col in record.keys():
                value = record[col]
                if hasattr(value, "strftime"):
                    value = value.strftime("%Y-%m-%d %H:%M:%S")
                row_dict[col] = value
            data.append(row_dict)

        return data

    def carry_forward_dies(self, forge_lines):
        now = datetime.now()
        current_shift = self.get_shift(now)
        prev_shift = self.get_previous_shift(current_shift)

        # FIX: Shift 3 (raat 23:30 - subah 7:30) ke liye date sahi calculate karo
        # Shift 3 mein current day aur previous day dono cover hote hain
        today = now.date()

        # Shift 3 mein agar time midnight ke baad hai toh "shift date" kal thi
        if current_shift == 3 and now.time() < time(7, 30):
            shift_date = today - timedelta(days=1)  # raat mein shift 3 kal se start hua
        else:
            shift_date = today

        # Previous shift ki date bhi sahi nikalo
        if prev_shift == 3:
            # Shift 3 kal raat ko thi
            prev_shift_date = shift_date - timedelta(days=1)
        else:
            prev_shift_date = shift_date

        # Lookback: 2 din peeche tak dekho (safety margin)
        lookback_date = prev_shift_date - timedelta(days=1)

        carried = []
        skipped = []

        for press in forge_lines:
            # Check: kya current shift mein is press ka data already hai?
            sql_check = (
                "SELECT COUNT(*) as cnt "
                "FROM kln_die_selection "
                "WHERE forge_press = '" + str(press) + "' "
                "AND shift = " + str(current_shift) + " "
                "AND CAST(created_at AS DATE) = '" + str(shift_date) + "'"
            )
            rs_check = sqlapi.RecordSet2(sql=sql_check)
            count = rs_check[0]["cnt"] if rs_check else 0

            if count > 0:
                skipped.append(press)
                continue

            # FIX: Previous shift ka data fetch karo — correct date range ke saath
            sql_prev = (
                "SELECT TOP 1 die_number, plant_code, cut_wt, net_wt, "
                "forge_stroke_selection, trim_stroke_selection "
                "FROM kln_die_selection "
                "WHERE forge_press = '" + str(press) + "' "
                "AND shift = " + str(prev_shift) + " "
                "AND CAST(created_at AS DATE) >= '" + str(lookback_date) + "' "
                "AND CAST(created_at AS DATE) <= '" + str(prev_shift_date) + "' "
                "ORDER BY created_at DESC"
            )
            rs_prev = sqlapi.RecordSet2(sql=sql_prev)

            if not rs_prev:
                self.logger.info(f"No previous shift data found for press: {press}")
                continue

            prev = rs_prev[0]
            record = sqlapi.Record("kln_die_selection")
            record["die_number"] = prev["die_number"]
            record["plant_code"] = prev["plant_code"]
            record["forge_press"] = press
            record["cut_wt"] = prev["cut_wt"]
            record["net_wt"] = prev["net_wt"]
            record["forge_stroke_selection"] = prev["forge_stroke_selection"]
            record["trim_stroke_selection"] = prev["trim_stroke_selection"]
            record["created_at"] = now
            record["shift"] = current_shift
            record.insert()

            carried.append({"press": press, "die_number": prev["die_number"]})
            self.logger.info(f"Carried forward press {press}, die {prev['die_number']} to shift {current_shift}")

        return {
            "status": "done",
            "current_shift": current_shift,
            "carried_forward": carried,
            "already_had_data": skipped,
        }


@DieSelection.path(model=DieSelectionData, path="")
def _path():
    return DieSelectionData()


@DieSelection.json(model=DieSelectionData, request_method="GET")
def _get_items(model, request):
    try:
        filters = {}
        if request.params.get('created_at'):
            filters['created_at'] = request.params.get('created_at')
        return model.get_die_data(filters)
    except Exception as e:
        model.logger.error("Error in GET endpoint: " + str(e))
        return {"message": "Failed to retrieve items"}


@DieSelection.json(model=DieSelectionData, request_method="POST")
def _carry_forward(model, request):
    try:
        incoming = request.json
        if not incoming or not isinstance(incoming.get("forge_lines"), list):
            return {"status": "error", "message": "forge_lines array is required"}
        return model.carry_forward_dies(incoming["forge_lines"])
    except Exception as e:
        model.logger.error("Error in carry_forward POST: " + str(e))
        return {"status": "error", "message": str(e)}