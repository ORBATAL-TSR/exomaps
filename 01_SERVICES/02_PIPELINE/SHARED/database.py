import os
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import scoped_session, sessionmaker
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy import text
# from fetch_db import simbad
# from fetch_db import exoplanetjpl

# Use ConfigManager for smart configuration handling
# Falls back to environment variables if ConfigManager not available
try:
    from config_manager import ConfigManager
    config = ConfigManager()
    con_str = config.get_db_url()
except ImportError:
    # Fallback for standalone execution or old environment
    user = os.environ.get('POSTGRES_USER', 'postgres')
    pwd = os.environ.get('POSTGRES_PASSWORD', '')
    db = os.environ.get('POSTGRES_DB', 'exomaps')
    host = os.environ.get('POSTGRES_HOST', '127.0.0.1')
    port = os.environ.get('POSTGRES_PORT', '5432')
    con_str = 'postgresql://%s:%s@%s:%s/%s' % (user, pwd, host, port, db)

engine = create_engine(con_str)

db_session = scoped_session(sessionmaker(autocommit=True,
                                         autoflush=False,
                                         bind=engine))
Base = declarative_base()
Base.query = db_session.query_property()


def _execute_sql_file(file_path):
    file_text = Path(file_path).read_text(encoding='utf-8').strip()
    if not file_text:
        return

    statements = [stmt.strip() for stmt in file_text.split(';') if stmt.strip()]
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def _apply_migrations(migrations_dir):
    with engine.begin() as connection:
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS public.schema_migrations (
                migration_name TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))

    migration_files = sorted(Path(migrations_dir).glob('*.sql'))
    for migration in migration_files:
        migration_name = migration.name
        with engine.begin() as connection:
            applied = connection.execute(
                text("SELECT 1 FROM public.schema_migrations WHERE migration_name = :name"),
                {'name': migration_name}
            ).scalar()

        if applied:
            continue

        _execute_sql_file(migration)
        with engine.begin() as connection:
            connection.execute(
                text("INSERT INTO public.schema_migrations (migration_name) VALUES (:name)"),
                {'name': migration_name}
            )


def schema_check(schema):
    schema_q = text("""
        SELECT EXISTS (
            SELECT *
            FROM pg_catalog.pg_namespace
            WHERE nspname = :schema
        )
    """)
    with engine.begin() as connection:
        return bool(connection.execute(schema_q, {'schema': schema}).scalar())


def init_db():
    # import all modules here that might define models so that
    # they will be registered properly on the metadata.  Otherwise
    # you will have to import them first before calling init_db()
    # import models
    # Base.metadata.create_all(bind=engine)
    print('init!')
    with engine.begin() as connection:
        test = connection.execute(text('SELECT 1 AS test'))
        for row in test:
            print(row[0])

    with engine.begin() as connection:
        user_q = text("SELECT True FROM pg_roles WHERE rolname = :rolename")
        if connection.execute(user_q, {'rolename': appuser}).scalar() is None:
            connection.execute(text("CREATE USER {}".format(appuser)))

        if connection.execute(user_q, {'rolename': 'application'}).scalar() is None:
            connection.execute(text("CREATE ROLE application"))

        connection.execute(text("GRANT application TO {}".format(appuser)))

    schema_list = ['stg_data', 'dm_galaxy', 'app_simulation']

    with engine.begin() as connection:
        for schema in schema_list:
            print('Building schema {}'.format(schema))
            connection.execute(text("CREATE SCHEMA IF NOT EXISTS {}".format(schema)))
            connection.execute(text("GRANT USAGE ON SCHEMA {} TO application".format(schema)))
            connection.execute(text("GRANT SELECT ON ALL TABLES IN SCHEMA {} TO application".format(schema)))
            connection.execute(text("""ALTER DEFAULT PRIVILEGES IN SCHEMA {}
                       GRANT SELECT ON TABLES TO application""".format(schema)))

        connection.execute(text("GRANT INSERT ON ALL TABLES IN SCHEMA app_simulation TO application"))
        connection.execute(text("""ALTER DEFAULT PRIVILEGES IN SCHEMA app_simulation
                   GRANT INSERT ON TABLES TO application"""))
        connection.execute(text("GRANT UPDATE ON ALL TABLES IN SCHEMA app_simulation TO application"))
        connection.execute(text("""ALTER DEFAULT PRIVILEGES IN SCHEMA app_simulation
                   GRANT UPDATE ON TABLES TO application"""))

    ddl_dir = Path(__file__).parent / 'ddl'
    create_schema_sql = ddl_dir / 'create_schemas.sql'
    if create_schema_sql.exists():
        _execute_sql_file(create_schema_sql)

    migrations_dir = ddl_dir / 'migrations'
    if migrations_dir.exists():
        _apply_migrations(migrations_dir)


    # DO SIMBAD STUFF
    # smb = simbad

    # Pull Starplot - 2002
    # http://starplot.org/data/sky2000-4-0.93.tar.gz
    # http://starplot.org/data/stars_with_planets_16th_September_2010.stars
    # ftp://cdsarc.u-strasbg.fr/cats/V/70A/catalog.dat.gz




if __name__ == "__main__":
    # app.run(host="0.0.0.0", debug=True)
    print('DB RUN IS UP!')
    init_db();
