import re
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from openpyxl import load_workbook

from customers.models import CountryMaster, DistrictMaster, StateMaster


def key(value):
    return re.sub(r"[^a-z0-9]", "", str(value or "").strip().lower())


def find_value(row, *names):
    wanted = {key(name) for name in names}
    for header, value in row.items():
        if key(header) in wanted and value not in (None, ""):
            return str(value).strip()
    return ""


def get_or_create_case_insensitive(model, name, **lookup):
    existing = model.objects.filter(name__iexact=name, **lookup).first()
    return existing or model.objects.create(name=name, **lookup)


class Command(BaseCommand):
    help = "Import Country, State and District masters from the location Excel workbook."

    def add_arguments(self, parser):
        parser.add_argument("workbook", type=str, help="Path to the .xlsx/.xlsm workbook")

    @transaction.atomic
    def handle(self, *args, **options):
        path = Path(options["workbook"])
        if not path.exists():
            raise CommandError(f"Workbook not found: {path}")
        try:
            workbook = load_workbook(path, read_only=True, data_only=True)
        except Exception as error:
            raise CommandError(f"Unable to read workbook: {error}") from error

        sheets = {key(name): sheet for name, sheet in ((name, workbook[name]) for name in workbook.sheetnames)}
        countries = {}
        states = {}
        districts = []

        def rows(sheet):
            values = sheet.iter_rows(values_only=True)
            headers = next(values, ())
            for raw in values:
                yield dict(zip(headers, raw))

        country_sheet = sheets.get("countrylist")
        if country_sheet:
            for row in rows(country_sheet):
                name = find_value(row, "CountryName", "Country", "Name")
                if name:
                    countries[name.casefold()] = name

        for sheet_name in ("statelist", "countrywisestates"):
            sheet = sheets.get(sheet_name)
            if not sheet:
                continue
            for row in rows(sheet):
                country = find_value(row, "CountryName", "Country", "Country Name") or "India"
                state = find_value(row, "StateName", "State", "State Name")
                district = find_value(row, "DistrictName", "District", "District Name")
                pincode = find_value(row, "Pincode", "PIN", "PostalCode", "Postal Code")
                if country:
                    countries[country.casefold()] = country
                if state:
                    states[(state.casefold(), country.casefold())] = (state, country)
                if district and state:
                    districts.append((district, state, country, pincode))

        # The supplied workbook also has a matrix format: country names are the
        # first-row headers and each column contains that country's states.
        matrix = sheets.get("countrywisestates")
        if matrix:
            values = matrix.iter_rows(values_only=True)
            headers = next(values, ())
            for column, country in enumerate(headers):
                if not country:
                    continue
                country = str(country).strip()
                countries[country.casefold()] = country
                for raw in values:
                    state = raw[column] if column < len(raw) else None
                    if state:
                        state = str(state).strip()
                        states[(state.casefold(), country.casefold())] = (state, country)
                # Iterating a read-only generator cannot be rewound per column;
                # matrix rows are collected once below for the remaining columns.
                break

            matrix_rows = list(matrix.iter_rows(min_row=2, values_only=True))
            for column, country in enumerate(headers):
                if not country:
                    continue
                country = str(country).strip()
                countries[country.casefold()] = country
                for raw in matrix_rows:
                    state = raw[column] if column < len(raw) else None
                    if state:
                        state = str(state).strip()
                        states[(state.casefold(), country.casefold())] = (state, country)

        # Some workbooks keep districts in a separate sheet; support that shape too.
        for name, sheet in sheets.items():
            if "district" not in name or name in {"countrywisestates", "statelist"}:
                continue
            for row in rows(sheet):
                country = find_value(row, "CountryName", "Country", "Country Name") or "India"
                state = find_value(row, "StateName", "State", "State Name")
                district = find_value(row, "DistrictName", "District", "District Name", "Name")
                pincode = find_value(row, "Pincode", "PIN", "PostalCode", "Postal Code")
                if district and state:
                    countries[country.casefold()] = country
                    states[(state.casefold(), country.casefold())] = (state, country)
                    districts.append((district, state, country, pincode))

        country_objects = {}
        for normalized, name in countries.items():
            country_objects[normalized] = get_or_create_case_insensitive(CountryMaster, name)
        state_objects = {}
        for (state_key, country_key), (name, country_name) in states.items():
            country = country_objects[country_key]
            state_objects[(state_key, country_key)] = get_or_create_case_insensitive(StateMaster, name, country=country)
        for district, state, country, pincode in districts:
            state_object = state_objects[(state.casefold(), country.casefold())]
            existing = DistrictMaster.objects.filter(name__iexact=district, state=state_object).first()
            if existing:
                if pincode:
                    existing.pincode = pincode
                    existing.save(update_fields=["pincode"])
            else:
                DistrictMaster.objects.create(name=district, state=state_object, pincode=pincode or None)
        self.stdout.write(self.style.SUCCESS(f"Imported {len(country_objects)} countries, {len(state_objects)} states and {len(districts)} district rows."))
