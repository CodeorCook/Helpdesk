from typing import Literal
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from core.validation import validate_phone
Role = Literal["customer", "staff", "manager"]

class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
    password: str = Field(min_length=1, max_length=1024, repr=False, json_schema_extra={"writeOnly":True,"format":"password"})

class UserResponse(BaseModel):
    id: str
    name: str
    email: str
    role: Role
    role_label: str

class SessionResponse(BaseModel):
    user: UserResponse
    csrf_token: str | None = None


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr = Field(max_length=150)
    phone: str | None = Field(default=None, max_length=20, pattern=r"^\+?[0-9 ()\-]{7,20}$")
    password: str = Field(min_length=12, max_length=1024, repr=False, json_schema_extra={"writeOnly":True,"format":"password"})
    password_confirmation: str = Field(min_length=1, max_length=1024, repr=False, json_schema_extra={"writeOnly":True,"format":"password"})

    _phone_valid = field_validator("phone")(validate_phone)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        if not value.strip():
            raise ValueError("Họ tên không được để trống.")
        return value.strip()

    @field_validator("email", mode="before")
    @classmethod
    def clean_email(cls, value):
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator("password")
    @classmethod
    def strong_password(cls, value):
        if not any(c.isalpha() for c in value) or not any(not c.isalpha() for c in value):
            raise ValueError("Mật khẩu cần có chữ và số hoặc ký tự đặc biệt.")
        return value

    @model_validator(mode="after")
    def matching_passwords(self):
        if self.password != self.password_confirmation:
            raise ValueError("Xác nhận mật khẩu không khớp.")
        return self


class RegisterResponse(BaseModel):
    message: str
