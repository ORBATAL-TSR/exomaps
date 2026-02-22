import argparse
import hashlib
import json
import os
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
from sqlalchemy import text


ADAPTER_VERSION = 'phase01.v1'


@dataclass
class ConnectorContract:
	source_name: str
	required_columns: list
	numeric_bounds: dict
	unique_keys: list
	null_forbidden: list


CONTRACTS = {
	'EXOPLANETS': ConnectorContract(
		source_name='EXOPLANETS',
		required_columns=['star_name', 'planet_name', 'ra', 'dec'],
		numeric_bounds={
			'ra': (0, 360),
			'dec': (-90, 90),
			'orbital_period': (0, 1_000_000),
			'semi_major_axis': (0, 100_000),
			'mass': (0, 100_000),
			'radius': (0, 10_000)
		},
		unique_keys=['star_name', 'planet_name'],
		null_forbidden=['star_name', 'planet_name', 'ra', 'dec']
	),
	'SIMBAD': ConnectorContract(
		source_name='SIMBAD',
		required_columns=['sys_id', 'main_id', 'average_of_ra', 'average_of_dec', 'average_of_dist'],
		numeric_bounds={
			'average_of_ra': (0, 360),
			'average_of_dec': (-90, 90),
			'average_of_dist': (0, 1_000_000)
		},
		unique_keys=['sys_id', 'main_id'],
		null_forbidden=['sys_id', 'main_id', 'average_of_ra', 'average_of_dec']
	)
}


def _normalize_columns(columns):
	normalized = []
	for column in columns:
		col = str(column).replace('\ufeff', '').strip().lower().replace(' ', '_')
		normalized.append(col)
	return normalized


def _source_name_for_file(file_path):
	file_name = Path(file_path).name.upper()
	if file_name.startswith('EXOPLANETS'):
		return 'EXOPLANETS'
	if file_name.startswith('SIMBAD'):
		return 'SIMBAD'
	return None


def _sha256_file(file_path):
	digest = hashlib.sha256()
	with open(file_path, 'rb') as file_handle:
		for chunk in iter(lambda: file_handle.read(8192), b''):
			digest.update(chunk)
	return digest.hexdigest()


def _insert_ingest_run(engine, run_id, run_name):
	with engine.begin() as connection:
		connection.execute(
			text("""
				INSERT INTO stg_data.ingest_runs (run_id, run_name, status)
				VALUES (:run_id, :run_name, 'running')
			"""),
			{'run_id': str(run_id), 'run_name': run_name}
		)


def _finalize_ingest_run(engine, run_id, status, notes=''):
	with engine.begin() as connection:
		connection.execute(
			text("""
				UPDATE stg_data.ingest_runs
				SET status = :status,
					finished_at = NOW(),
					notes = :notes
				WHERE run_id = :run_id
			"""),
			{'run_id': str(run_id), 'status': status, 'notes': notes}
		)


def _save_manifest(engine, payload):
	with engine.begin() as connection:
		connection.execute(
			text("""
				INSERT INTO stg_data.source_manifest (
					run_id,
					source_name,
					file_name,
					file_path,
					file_checksum_sha256,
					source_release_date,
					adapter_version,
					row_count,
					status,
					metadata
				) VALUES (
					:run_id,
					:source_name,
					:file_name,
					:file_path,
					:file_checksum_sha256,
					:source_release_date,
					:adapter_version,
					:row_count,
					:status,
					CAST(:metadata AS JSONB)
				)
			"""),
			payload
		)


def _save_validation_summary(engine, payload):
	with engine.begin() as connection:
		connection.execute(
			text("""
				INSERT INTO stg_data.validation_summary (
					run_id,
					source_name,
					total_rows,
					accepted_rows,
					quarantined_rows,
					warning_count,
					fail_count,
					gate_status,
					details
				) VALUES (
					:run_id,
					:source_name,
					:total_rows,
					:accepted_rows,
					:quarantined_rows,
					:warning_count,
					:fail_count,
					:gate_status,
					CAST(:details AS JSONB)
				)
			"""),
			payload
		)


def _save_quarantine_rows(engine, quarantine_rows):
	if not quarantine_rows:
		return

	with engine.begin() as connection:
		for row in quarantine_rows:
			connection.execute(
				text("""
					INSERT INTO stg_data.validation_quarantine (
						run_id,
						source_name,
						source_table,
						row_number,
						error_code,
						error_detail,
						raw_record
					) VALUES (
						:run_id,
						:source_name,
						:source_table,
						:row_number,
						:error_code,
						:error_detail,
						CAST(:raw_record AS JSONB)
					)
				"""),
				row
			)


def _record_gate_defaults(engine):
	defaults = [
		('EXOPLANETS', 'max_quarantine_rate', 0.20, 'lte', 'fail'),
		('SIMBAD', 'max_quarantine_rate', 0.20, 'lte', 'fail'),
		('EXOPLANETS', 'max_duplicate_rate', 0.10, 'lte', 'warn'),
		('SIMBAD', 'max_duplicate_rate', 0.10, 'lte', 'warn')
	]

	with engine.begin() as connection:
		for source_name, gate_name, threshold_value, threshold_mode, severity in defaults:
			connection.execute(
				text("""
					INSERT INTO stg_data.pipeline_gate_config (
						source_name,
						gate_name,
						threshold_value,
						threshold_mode,
						severity,
						is_active
					) VALUES (
						:source_name,
						:gate_name,
						:threshold_value,
						:threshold_mode,
						:severity,
						TRUE
					)
					ON CONFLICT (source_name, gate_name)
					DO NOTHING
				"""),
				{
					'source_name': source_name,
					'gate_name': gate_name,
					'threshold_value': threshold_value,
					'threshold_mode': threshold_mode,
					'severity': severity
				}
			)


def _record_contract_snapshot(engine):
	with engine.begin() as connection:
		for source_name, contract in CONTRACTS.items():
			connection.execute(
				text("""
					INSERT INTO stg_data.connector_contracts (
						source_name,
						contract_version,
						required_columns,
						numeric_bounds,
						unique_keys,
						null_policy
					) VALUES (
						:source_name,
						:contract_version,
						CAST(:required_columns AS JSONB),
						CAST(:numeric_bounds AS JSONB),
						CAST(:unique_keys AS JSONB),
						CAST(:null_policy AS JSONB)
					)
					ON CONFLICT (source_name, contract_version)
					DO NOTHING
				"""),
				{
					'source_name': source_name,
					'contract_version': ADAPTER_VERSION,
					'required_columns': json.dumps(contract.required_columns),
					'numeric_bounds': json.dumps(contract.numeric_bounds),
					'unique_keys': json.dumps(contract.unique_keys),
					'null_policy': json.dumps({'null_forbidden': contract.null_forbidden})
				}
			)


def _build_quarantine_row(run_id, source_name, source_table, row_number, error_code, error_detail, raw_record):
	cleaned_record = {}
	for key, value in raw_record.items():
		if pd.isna(value):
			cleaned_record[key] = None
		else:
			cleaned_record[key] = value

	return {
		'run_id': str(run_id),
		'source_name': source_name,
		'source_table': source_table,
		'row_number': int(row_number) if row_number is not None else None,
		'error_code': error_code,
		'error_detail': error_detail,
		'raw_record': json.dumps(cleaned_record, default=str)
	}


def _gate_status(total_rows, quarantined_rows, duplicate_rows):
	if total_rows == 0:
		return 'fail', 0, 1

	quarantine_rate = quarantined_rows / total_rows
	duplicate_rate = duplicate_rows / total_rows

	warning_count = 0
	fail_count = 0

	if duplicate_rate > 0.10:
		warning_count += 1
	if quarantine_rate > 0.20:
		fail_count += 1

	if fail_count > 0:
		return 'fail', warning_count, fail_count
	if warning_count > 0:
		return 'warn', warning_count, fail_count
	return 'pass', warning_count, fail_count


def validate_csv_file(file_path, contract, run_id):
	source_table = Path(file_path).stem.lower()
	data_frame = pd.read_csv(file_path)
	data_frame.columns = _normalize_columns(data_frame.columns)

	missing_columns = [column for column in contract.required_columns if column not in data_frame.columns]
	if missing_columns:
		raise ValueError(
			'Missing required columns for {}: {}'.format(contract.source_name, ', '.join(missing_columns))
		)

	quarantine_rows = []
	row_errors = {}

	def add_row_error(index, code, detail):
		row_errors.setdefault(index, []).append((code, detail))

	for column in contract.null_forbidden:
		null_mask = data_frame[column].isna() | (data_frame[column].astype(str).str.strip() == '')
		for row_index in data_frame[null_mask].index:
			add_row_error(row_index, 'REQUIRED_NULL', 'Column {} cannot be null/blank'.format(column))

	for column, bounds in contract.numeric_bounds.items():
		if column not in data_frame.columns:
			continue
		min_value, max_value = bounds
		original_values = data_frame[column]
		numeric_values = pd.to_numeric(original_values, errors='coerce')
		invalid_numeric_mask = original_values.notna() & numeric_values.isna()
		out_of_range_mask = numeric_values.notna() & ((numeric_values < min_value) | (numeric_values > max_value))

		data_frame[column] = numeric_values

		for row_index in data_frame[invalid_numeric_mask].index:
			add_row_error(row_index, 'INVALID_NUMERIC', 'Column {} could not be parsed as numeric'.format(column))

		for row_index in data_frame[out_of_range_mask].index:
			add_row_error(
				row_index,
				'OUT_OF_RANGE',
				'Column {} outside range {}..{}'.format(column, min_value, max_value)
			)

	duplicate_count = 0
	if contract.unique_keys and all(column in data_frame.columns for column in contract.unique_keys):
		duplicate_mask = data_frame.duplicated(subset=contract.unique_keys, keep='first')
		duplicate_count = int(duplicate_mask.sum())
		for row_index in data_frame[duplicate_mask].index:
			add_row_error(
				row_index,
				'DUPLICATE_IDENTITY',
				'Duplicate values for unique keys {}'.format(', '.join(contract.unique_keys))
			)

	for row_index, errors in row_errors.items():
		raw_record = data_frame.iloc[row_index].to_dict()
		for error_code, error_detail in errors:
			quarantine_rows.append(
				_build_quarantine_row(
					run_id=run_id,
					source_name=contract.source_name,
					source_table=source_table,
					row_number=row_index + 2,
					error_code=error_code,
					error_detail=error_detail,
					raw_record=raw_record
				)
			)

	invalid_indices = set(row_errors.keys())
	accepted_frame = data_frame.drop(index=list(invalid_indices)).copy()

	gate_status, warning_count, fail_count = _gate_status(
		total_rows=len(data_frame),
		quarantined_rows=len(invalid_indices),
		duplicate_rows=duplicate_count
	)

	return {
		'accepted_frame': accepted_frame,
		'quarantine_rows': quarantine_rows,
		'total_rows': int(len(data_frame)),
		'accepted_rows': int(len(accepted_frame)),
		'quarantined_rows': int(len(invalid_indices)),
		'warning_count': warning_count,
		'fail_count': fail_count,
		'gate_status': gate_status,
		'source_table': source_table,
		'details': {
			'duplicate_rows': duplicate_count,
			'error_rows': len(invalid_indices)
		}
	}


def run_phase01_ingestion(engine, data_dir):
	data_path = Path(data_dir)
	if not data_path.exists() or not data_path.is_dir():
		raise ValueError('Data directory does not exist: {}'.format(data_dir))

	run_id = uuid.uuid4()
	run_name = 'phase01_ingestion'

	_insert_ingest_run(engine, run_id, run_name)
	_record_gate_defaults(engine)
	_record_contract_snapshot(engine)

	files = sorted(data_path.glob('*.csv'))
	if not files:
		_finalize_ingest_run(engine, run_id, 'warn', 'No CSV files found')
		return str(run_id)

	processed = 0
	failed = 0
	for csv_path in files:
		source_name = _source_name_for_file(csv_path)
		if source_name is None or source_name not in CONTRACTS:
			continue

		contract = CONTRACTS[source_name]
		checksum = _sha256_file(csv_path)

		try:
			validation_result = validate_csv_file(csv_path, contract, run_id)
			accepted_frame = validation_result['accepted_frame']
			table_name = '{}_raw'.format(validation_result['source_table'])

			accepted_frame.insert(0, 'ingest_run_id', str(run_id))
			accepted_frame.insert(1, 'source_file', csv_path.name)
			accepted_frame.to_sql(
				table_name,
				engine,
				schema='stg_data',
				if_exists='append',
				index=False,
				method='multi'
			)

			_save_quarantine_rows(engine, validation_result['quarantine_rows'])

			_save_validation_summary(
				engine,
				{
					'run_id': str(run_id),
					'source_name': source_name,
					'total_rows': validation_result['total_rows'],
					'accepted_rows': validation_result['accepted_rows'],
					'quarantined_rows': validation_result['quarantined_rows'],
					'warning_count': validation_result['warning_count'],
					'fail_count': validation_result['fail_count'],
					'gate_status': validation_result['gate_status'],
					'details': json.dumps(validation_result['details'])
				}
			)

			_save_manifest(
				engine,
				{
					'run_id': str(run_id),
					'source_name': source_name,
					'file_name': csv_path.name,
					'file_path': str(csv_path),
					'file_checksum_sha256': checksum,
					'source_release_date': None,
					'adapter_version': ADAPTER_VERSION,
					'row_count': validation_result['total_rows'],
					'status': validation_result['gate_status'],
					'metadata': json.dumps(
						{
							'accepted_rows': validation_result['accepted_rows'],
							'quarantined_rows': validation_result['quarantined_rows'],
							'source_table': table_name
						}
					)
				}
			)
			processed += 1
		except Exception as exception:
			failed += 1
			_save_manifest(
				engine,
				{
					'run_id': str(run_id),
					'source_name': source_name,
					'file_name': csv_path.name,
					'file_path': str(csv_path),
					'file_checksum_sha256': checksum,
					'source_release_date': None,
					'adapter_version': ADAPTER_VERSION,
					'row_count': 0,
					'status': 'fail',
					'metadata': json.dumps({'error': str(exception)})
				}
			)

	final_status = 'pass' if failed == 0 else 'warn'
	_finalize_ingest_run(
		engine,
		run_id,
		final_status,
		'Processed files: {}; failed files: {}'.format(processed, failed)
	)

	return str(run_id)


def main():
	parser = argparse.ArgumentParser(description='Run Phase 01 CSV ingestion pipeline')
	parser.add_argument('--data-dir', default=os.environ.get('PHASE01_DATA_DIR', '/opt/services/data'))
	args = parser.parse_args()

	dbs_root = Path(__file__).resolve().parents[1]
	if str(dbs_root) not in sys.path:
		sys.path.insert(0, str(dbs_root))

	from database import engine

	run_id = run_phase01_ingestion(engine, args.data_dir)
	print('Phase 01 ingestion complete. run_id={}'.format(run_id))


if __name__ == '__main__':
	main()
