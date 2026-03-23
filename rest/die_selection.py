from cs.platform.web import JsonAPI
from cs.platform.web.root import Internal
from datetime import datetime, timedelta, time
from cdb import sqlapi, auth
from typing import Dict, Any
import logging
import tempfile
import traceback


class DieSelection(JsonAPI):
    pass


@Internal.mount(app=DieSelection, path="die_selection")
def _mount_app():
    return DieSelection()


# ── logging helper (same pattern as stroke_selection.py) ─────────────────────
def Print_log(exc):
    with open(tempfile.gettempdir() + "\\opcua_log.txt", "a+") as log_file:
        log_file.write("\n" + datetime.now().strftime("%d.%m.%Y %H:%M:%S") + ":" + str(exc))
        log_file.write("\n " + traceback.format_exc())


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
            "trim_stroke_selection, plant_code, created_at, shift, forge_stroke_counter, tonnage "
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
        today = now.date()

        # ── Current shift date boundary ──────────────────────────────────────
        if current_shift == 3 and now.time() < time(7, 30):
            shift_date = today - timedelta(days=1)
        else:
            shift_date = today

        carried = []
        skipped = []
        errors = []

        for press in forge_lines:
            try:
                # ── 1. Skip if current shift already has data for this press ─
                sql_check = (
                        "SELECT COUNT(*) as cnt "
                        "FROM kln_die_selection "
                        "WHERE forge_press = '" + str(press) + "' "
                                                               "AND shift = " + str(current_shift) + " "
                                                                                                     "AND CAST(created_at AS DATE) = '" + str(
                    shift_date) + "'"
                )
                rs_check = sqlapi.RecordSet2(sql=sql_check)
                count = rs_check[0]["cnt"] if rs_check else 0

                if count > 0:
                    skipped.append(press)
                    self.logger.info(f"Carry-forward skipped (already has data): press={press} shift={current_shift}")
                    continue

                # ── 2. Get the single latest die ever saved for this press ───
                # No shift/date filter — just the absolute latest record
                sql_latest = (
                        "SELECT TOP 1 die_number, plant_code, cut_wt, net_wt, "
                        "forge_stroke_selection, trim_stroke_selection "
                        "FROM kln_die_selection "
                        "WHERE forge_press = '" + str(press) + "' "
                                                               "ORDER BY created_at DESC"
                )
                rs_latest = sqlapi.RecordSet2(sql=sql_latest)

                if not rs_latest:
                    self.logger.info(f"Carry-forward: no previous data found for press={press}")
                    continue

                prev = rs_latest[0]
                plant_code = prev["plant_code"]
                die_number = prev["die_number"]

                if not plant_code or not die_number:
                    errors.append({"press": press, "reason": "missing plant_code or die_number"})
                    continue

                # ── 3. Duplicate guard ────────────────────────────────────────
                sql_dup = (
                        "SELECT COUNT(*) as cnt "
                        "FROM kln_die_selection "
                        "WHERE die_number = '" + str(die_number) + "' "
                                                                   "AND plant_code = " + str(plant_code) + " "
                                                                                                           "AND forge_press = '" + str(
                    press) + "' "
                             "AND shift = " + str(current_shift) + " "
                                                                   "AND CAST(created_at AS DATE) = '" + str(
                    shift_date) + "'"
                )
                rs_dup = sqlapi.RecordSet2(sql=sql_dup)
                if rs_dup and rs_dup[0]["cnt"] > 0:
                    skipped.append(press)
                    continue

                # ── 4. Insert carried record ──────────────────────────────────
                record = sqlapi.Record("kln_die_selection")
                record["die_number"] = die_number
                record["plant_code"] = plant_code
                record["forge_press"] = press
                record["cut_wt"] = prev["cut_wt"]
                record["net_wt"] = prev["net_wt"]
                record["forge_stroke_selection"] = prev["forge_stroke_selection"]
                record["trim_stroke_selection"] = prev["trim_stroke_selection"]
                record["created_at"] = now
                record["shift"] = current_shift
                # forge_stroke_counter and tonnage start NULL — filled when next die is added
                record.insert()

                carried.append({"press": press, "die_number": die_number})
                self.logger.info(f"Carried forward press={press} die={die_number} to shift={current_shift}")

            except Exception as e:
                error_msg = f"Carry-forward FAILED for press={press}: {str(e)}"
                self.logger.error(error_msg)
                Print_log(error_msg)
                errors.append({"press": press, "reason": str(e)})
                continue

        return {
            "status": "done",
            "current_shift": current_shift,
            "carried_forward": carried,
            "already_had_data": skipped,
            "errors": errors,
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