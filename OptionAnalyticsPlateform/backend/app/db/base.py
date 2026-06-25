from app.db.base_class import Base  # noqa
from app.models.user import UserProfile  # Note: UserProfile is currently Pydantic, not SQLAlchemy.
from app.models.market_data import MarketData  # noqa
# We will import MarketData here once it's created.
