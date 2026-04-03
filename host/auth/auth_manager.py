# OTP 2차 인증 + JWT 세션 관리
from __future__ import annotations

import json
import logging
import secrets
import time
from pathlib import Path

import jwt
import pyotp
import qrcode
import qrcode.constants

logger = logging.getLogger(__name__)

CONFIG_FILE = Path(__file__).parent.parent / "auth_config.json"
JWT_ALGORITHM = "HS256"
JWT_EXPIRY = 86400  # 24시간


class AuthManager:
    """비밀번호 + TOTP OTP 인증, JWT 세션, 동시접속 1명 제한."""

    def __init__(self) -> None:
        self._password: str = ""
        self._totp_secret: str = ""
        self._jwt_secret: str = ""
        self._active_token: str | None = None  # 동시접속 1명
        self._active_since: float = 0
        self._load_or_create_config()

    def _load_or_create_config(self) -> None:
        if CONFIG_FILE.exists():
            data = json.loads(CONFIG_FILE.read_text())
            self._password = data["password"]
            self._totp_secret = data["totp_secret"]
            self._jwt_secret = data["jwt_secret"]
            logger.info("Auth config loaded")
        else:
            self._password = secrets.token_urlsafe(12)
            self._totp_secret = pyotp.random_base32()
            self._jwt_secret = secrets.token_urlsafe(32)
            self._save_config()
            logger.info("New auth config created")
            self._print_setup_info()

    def _save_config(self) -> None:
        CONFIG_FILE.write_text(json.dumps({
            "password": self._password,
            "totp_secret": self._totp_secret,
            "jwt_secret": self._jwt_secret,
        }, indent=2))

    def _print_setup_info(self) -> None:
        totp = pyotp.TOTP(self._totp_secret)
        uri = totp.provisioning_uri(name="Ideality", issuer_name="IdelaityRemote")

        print("\n" + "=" * 50)
        print("  Ideality Remote Desktop — 초기 설정")
        print("=" * 50)
        print(f"  비밀번호: {self._password}")
        print(f"  OTP Secret: {self._totp_secret}")
        print(f"\n  Authenticator 앱에 아래 QR 코드를 스캔하세요:")
        print(f"  (또는 수동 입력: {self._totp_secret})")

        # 터미널에 QR 코드 표시
        qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_L, box_size=1, border=1)
        qr.add_data(uri)
        qr.make(fit=True)
        qr.print_ascii(invert=True)

        print(f"\n  설정 파일: {CONFIG_FILE}")
        print("  비밀번호를 변경하려면 auth_config.json을 수정하세요.")
        print("=" * 50 + "\n")

    def show_credentials(self) -> None:
        """현재 비밀번호와 OTP 정보 표시."""
        totp = pyotp.TOTP(self._totp_secret)
        uri = totp.provisioning_uri(name="Ideality", issuer_name="IdealityRemote")

        print(f"\n  비밀번호: {self._password}")
        print(f"  OTP Secret: {self._totp_secret}")
        print(f"  현재 OTP: {totp.now()}")

        qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_L, box_size=1, border=1)
        qr.add_data(uri)
        qr.make(fit=True)
        qr.print_ascii(invert=True)

    def authenticate(self, password: str, otp_code: str) -> str | None:
        """비밀번호 + OTP 검증. 성공 시 JWT 토큰 반환, 실패 시 None."""
        if password != self._password:
            logger.warning("Auth failed: wrong password")
            return None

        totp = pyotp.TOTP(self._totp_secret)
        if not totp.verify(otp_code, valid_window=1):
            logger.warning("Auth failed: invalid OTP")
            return None

        # 기존 세션 강제 종료 (동시접속 1명)
        if self._active_token:
            logger.info("Previous session terminated")

        token = jwt.encode(
            {"exp": time.time() + JWT_EXPIRY, "iat": time.time()},
            self._jwt_secret,
            algorithm=JWT_ALGORITHM,
        )
        self._active_token = token
        self._active_since = time.time()
        logger.info("Auth success — new session")
        return token

    def verify_token(self, token: str) -> bool:
        """JWT 토큰 검증 + 활성 세션 확인."""
        if token != self._active_token:
            return False
        try:
            jwt.decode(token, self._jwt_secret, algorithms=[JWT_ALGORITHM])
            return True
        except jwt.ExpiredSignatureError:
            self._active_token = None
            return False
        except jwt.InvalidTokenError:
            return False

    def logout(self, token: str) -> bool:
        if token == self._active_token:
            self._active_token = None
            logger.info("Session logged out")
            return True
        return False

    @property
    def has_active_session(self) -> bool:
        if self._active_token is None:
            return False
        return self.verify_token(self._active_token)

    def change_password(self, new_password: str) -> None:
        self._password = new_password
        self._save_config()
        logger.info("Password changed")
