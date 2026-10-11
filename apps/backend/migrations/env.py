import os
from alembic import context
from sqlalchemy import create_engine, pool
from wikimf.db import Base, configured_database_url

config = context.config
url = configured_database_url() if os.getenv("DATABASE_HOST") or os.getenv("DATABASE_URL") else config.get_main_option("sqlalchemy.url")
target_metadata = Base.metadata

if context.is_offline_mode():
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = create_engine(url, poolclass=pool.NullPool, hide_parameters=True)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
