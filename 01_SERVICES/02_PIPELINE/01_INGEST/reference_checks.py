import argparse
import json
import math
import sys
import uuid
from pathlib import Path

import pandas as pd
from sqlalchemy import text

PARSEC_TO_LY = 3.26156


def _load_rules(rules_path):
    payload = json.loads(Path(rules_path).read_text(encoding='utf-8'))
    return payload.get('rules', [])


def _upsert_rules(engine, rules):
    with engine.begin() as connection:
        for rule in rules:
            connection.execute(
                text(
                    """
                    INSERT INTO stg_data.reference_validation_rules (
                        rule_key,
                        rule_name,
                        description,
                        expected_value,
                        tolerance,
                        units,
                        matcher,
                        is_active,
                        updated_at
                    ) VALUES (
                        :rule_key,
                        :rule_name,
                        :description,
                        :expected_value,
                        :tolerance,
                        :units,
                        CAST(:matcher AS JSONB),
                        TRUE,
                        NOW()
                    )
                    ON CONFLICT (rule_key)
                    DO UPDATE SET
                        rule_name = EXCLUDED.rule_name,
                        description = EXCLUDED.description,
                        expected_value = EXCLUDED.expected_value,
                        tolerance = EXCLUDED.tolerance,
                        units = EXCLUDED.units,
                        matcher = EXCLUDED.matcher,
                        updated_at = NOW()
                    """
                ),
                {
                    'rule_key': rule['rule_key'],
                    'rule_name': rule['rule_name'],
                    'description': rule['description'],
                    'expected_value': float(rule['expected_value']),
                    'tolerance': float(rule['tolerance']),
                    'units': rule['units'],
                    'matcher': json.dumps(rule['matcher'])
                }
            )


def _latest_simbad_tables(engine):
    query = text(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'stg_data'
          AND table_name LIKE 'simbad%_raw'
        ORDER BY table_name
        """
    )
    with engine.begin() as connection:
        rows = connection.execute(query).fetchall()
    return [row[0] for row in rows]


def _load_simbad_records(engine, table_names):
    if not table_names:
        return pd.DataFrame()

    frames = []
    for table_name in table_names:
        query = f"""
            SELECT
                '{table_name}' AS source_table,
                main_id,
                ids,
                average_of_ra,
                average_of_dec,
                average_of_dist
            FROM stg_data.{table_name}
        """
        frame = pd.read_sql_query(query, con=engine)
        frames.append(frame)

    merged = pd.concat(frames, ignore_index=True)
    merged.columns = [c.lower() for c in merged.columns]
    merged['main_id'] = merged['main_id'].fillna('').astype(str)
    merged['ids'] = merged['ids'].fillna('').astype(str)
    merged['average_of_dist'] = pd.to_numeric(merged['average_of_dist'], errors='coerce')
    merged['average_of_ra'] = pd.to_numeric(merged['average_of_ra'], errors='coerce')
    merged['average_of_dec'] = pd.to_numeric(merged['average_of_dec'], errors='coerce')
    return merged


def _match_rule(frame, matcher):
    aliases = matcher.get('contains_any', [])
    if not aliases:
        return frame.iloc[0:0]

    mask = pd.Series([False] * len(frame))
    for alias in aliases:
        alias_u = alias.upper()
        mask = mask | frame['main_id'].str.upper().str.contains(alias_u, na=False)
        mask = mask | frame['ids'].str.upper().str.contains(alias_u, na=False)

    return frame[mask].copy()


def _distance_parsec_to_ly(distance_parsec):
    if distance_parsec is None or math.isnan(distance_parsec):
        return None
    return float(distance_parsec) * PARSEC_TO_LY


def _compute_xyz(distance_ly, ra_deg, dec_deg):
    ra = math.radians(float(ra_deg))
    dec = math.radians(float(dec_deg))
    x = distance_ly * math.cos(dec) * math.cos(ra)
    y = distance_ly * math.cos(dec) * math.sin(ra)
    z = distance_ly * math.sin(dec)
    return x, y, z


def _save_result(engine, payload):
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO stg_data.reference_validation_results (
                    run_id,
                    rule_key,
                    source_table,
                    source_main_id,
                    observed_value,
                    expected_value,
                    absolute_error,
                    tolerance,
                    status,
                    details
                ) VALUES (
                    :run_id,
                    :rule_key,
                    :source_table,
                    :source_main_id,
                    :observed_value,
                    :expected_value,
                    :absolute_error,
                    :tolerance,
                    :status,
                    CAST(:details AS JSONB)
                )
                """
            ),
            payload
        )


def run_reference_checks(engine, rules_path, run_id=None):
    rules = _load_rules(rules_path)
    _upsert_rules(engine, rules)

    table_names = _latest_simbad_tables(engine)
    records = _load_simbad_records(engine, table_names)

    if records.empty:
        return {
            'run_id': run_id,
            'status': 'warn',
            'message': 'No simbad raw tables found for validation',
            'results': []
        }

    results = []
    for rule in rules:
        matched = _match_rule(records, rule['matcher'])
        if matched.empty:
            result_payload = {
                'run_id': run_id,
                'rule_key': rule['rule_key'],
                'source_table': None,
                'source_main_id': None,
                'observed_value': None,
                'expected_value': float(rule['expected_value']),
                'absolute_error': None,
                'tolerance': float(rule['tolerance']),
                'status': 'warn',
                'details': json.dumps({'reason': 'No matched source rows'})
            }
            _save_result(engine, result_payload)
            results.append(result_payload)
            continue

        matched = matched.copy()
        matched['distance_ly'] = matched['average_of_dist'].apply(_distance_parsec_to_ly)
        matched = matched[matched['distance_ly'].notna()]

        if matched.empty:
            result_payload = {
                'run_id': run_id,
                'rule_key': rule['rule_key'],
                'source_table': None,
                'source_main_id': None,
                'observed_value': None,
                'expected_value': float(rule['expected_value']),
                'absolute_error': None,
                'tolerance': float(rule['tolerance']),
                'status': 'warn',
                'details': json.dumps({'reason': 'Matched rows missing numeric distance'})
            }
            _save_result(engine, result_payload)
            results.append(result_payload)
            continue

        matched['abs_error'] = (matched['distance_ly'] - float(rule['expected_value'])).abs()
        best = matched.sort_values('abs_error').iloc[0]
        observed_value = float(best['distance_ly'])
        expected_value = float(rule['expected_value'])
        absolute_error = float(abs(observed_value - expected_value))
        tolerance = float(rule['tolerance'])
        status = 'pass' if absolute_error <= tolerance else 'fail'

        details = {
            'description': rule['description'],
            'units': rule['units'],
            'aliases': rule['matcher'].get('contains_any', []),
            'raw_distance_parsec': None if pd.isna(best['average_of_dist']) else float(best['average_of_dist'])
        }

        if pd.notna(best['average_of_ra']) and pd.notna(best['average_of_dec']):
            x, y, z = _compute_xyz(observed_value, best['average_of_ra'], best['average_of_dec'])
            radial_distance = math.sqrt((x ** 2) + (y ** 2) + (z ** 2))
            details['xyz'] = {'x': x, 'y': y, 'z': z}
            details['radial_reconstruction_error'] = abs(radial_distance - observed_value)

        result_payload = {
            'run_id': run_id,
            'rule_key': rule['rule_key'],
            'source_table': str(best['source_table']),
            'source_main_id': str(best['main_id']),
            'observed_value': observed_value,
            'expected_value': expected_value,
            'absolute_error': absolute_error,
            'tolerance': tolerance,
            'status': status,
            'details': json.dumps(details)
        }
        _save_result(engine, result_payload)
        results.append(result_payload)

    pass_count = len([result for result in results if result['status'] == 'pass'])
    fail_count = len([result for result in results if result['status'] == 'fail'])
    warn_count = len([result for result in results if result['status'] == 'warn'])

    return {
        'run_id': run_id,
        'status': 'pass' if fail_count == 0 else 'warn',
        'message': 'reference checks completed',
        'summary': {
            'pass': pass_count,
            'fail': fail_count,
            'warn': warn_count,
            'total': len(results)
        },
        'results': results
    }


def main():
    parser = argparse.ArgumentParser(description='Run Phase 01 reference validation checks')
    parser.add_argument('--run-id', default=None)
    parser.add_argument(
        '--rules-path',
        default=str(Path(__file__).resolve().parent / 'reference_rules.json')
    )
    args = parser.parse_args()

    dbs_root = Path(__file__).resolve().parents[1]
    if str(dbs_root) not in sys.path:
        sys.path.insert(0, str(dbs_root))

    from database import engine

    run_id = args.run_id
    if run_id:
        run_id = str(uuid.UUID(run_id))

    result = run_reference_checks(engine, args.rules_path, run_id=run_id)
    print(json.dumps(result, indent=2, default=str))


if __name__ == '__main__':
    main()
