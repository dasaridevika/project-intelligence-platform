import uuid
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import decode_token, hash_password, verify_password
from app.models.user import User

security_scheme = HTTPBearer(auto_error=False)


async def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme),
    db: AsyncSession = Depends(get_db)
) -> Optional[User]:
    """Extracts user from JWT token if provided; returns None if anonymous."""
    if not credentials:
        return None
    token = credentials.credentials
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        return None
    user_id_str = payload.get("sub")
    if not user_id_str:
        return None
    try:
        user_id = uuid.UUID(user_id_str)
    except ValueError:
        return None

    stmt = select(User).where(User.id == user_id, User.is_active == True)
    res = await db.execute(stmt)
    return res.scalar_one_or_none()


async def get_current_user(
    user: Optional[User] = Depends(get_current_user_optional)
) -> User:
    """Enforces authentication; raises 401 Unauthorized if missing/invalid."""
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials are required and must be valid",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def get_current_admin(
    user: User = Depends(get_current_user)
) -> User:
    """Enforces admin role."""
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator privileges are required for this action"
        )
    return user
