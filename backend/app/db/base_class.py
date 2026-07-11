from typing import Any

from sqlalchemy.orm import as_declarative, declared_attr


@as_declarative()
class Base:
    id: Any
    __name__: str

    # Generate __tablename__ automatically
    @declared_attr  # type: ignore[arg-type]
    def __tablename__(cls) -> str:  # noqa: N805 - SQLAlchemy declared_attr convention
        return cls.__name__.lower()
