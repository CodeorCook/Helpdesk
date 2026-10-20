import re


def validate_phone(value):
    if value is None:
        return None
    value = value.strip()
    digits = sum(c.isdigit() for c in value)
    if not re.fullmatch(r"\+?[0-9 ()-]{7,20}", value) or not 7 <= digits <= 15:
        raise ValueError("Số điện thoại cần 7–15 chữ số, có thể có dấu +, khoảng trắng, ngoặc hoặc gạch nối.")
    return value
