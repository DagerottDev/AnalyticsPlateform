from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings

settings = get_settings()

# Create async engine
engine = create_async_engine(
    str(settings.database_url),
    pool_pre_ping=True,
    echo=settings.app_debug,
    hide_parameters=True,
)

# Create session maker
async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency for database sessions."""
    async with async_session_maker() as session:
        try:
            yield session
        finally:
            await session.close()
