from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

# Create async engine
engine = create_async_engine(
    str(settings.database_url),
    pool_pre_ping=True,
    echo=settings.app_debug,
)

# Create session maker
async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

async def get_db():
    """FastAPI dependency for database sessions."""
    async with async_session_maker() as session:
        try:
            yield session
        finally:
            await session.close()
