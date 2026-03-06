from cs.platform.web import JsonAPI
from cs.platform.web.root import Internal
from datetime import datetime,timedelta
from cdb import sqlapi, auth
from typing import Dict, List, Optional, Any
import logging

class DieSelection(JsonAPI):
    pass

@Internal.mount(app=DieSelection, path="die_selection")
def _mount_app():
    return DieSelection()


class DieSelectionData:

    def __init__(self):
        self.logger = logging.getLogger(__name__)

    def get_die_data(self, filters=None):
        filters = filters or {}

        sqldata = (
            "SELECT die_number, forge_press, net_wt, cut_wt, forge_stroke_selection, "
            "trim_stroke_selection, plant_code, created_at, shift "
            "FROM kln_die_selection"
        )

        if filters.get('created_at'):
            user_date = datetime.strptime(filters['created_at'], "%Y-%m-%d")

            start_datetime = user_date.replace(hour=7, minute=30, second=0)
            end_datetime = start_datetime + timedelta(days=1)

            sqldata += f"""
                WHERE created_at >= '{start_datetime.strftime("%Y-%m-%d %H:%M:%S")}'
                  AND created_at < '{end_datetime.strftime("%Y-%m-%d %H:%M:%S")}'
            """

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


@DieSelection.path(model=DieSelectionData, path="")
def _path():
    return DieSelectionData()

@DieSelection.json(model=DieSelectionData,request_method="GET")
def _get_items(model, request):
    """GET endpoint for retrieving production items"""
    try:
        filters = {}
        if request.params.get('created_at'):
            filters['created_at'] = request.params.get('created_at')

        return model.get_die_data(filters)
    except Exception as e:
        model.logger.error(f"Error in GET endpoint: {str(e)}")
        return {"message": "Failed to retrieve items"}

