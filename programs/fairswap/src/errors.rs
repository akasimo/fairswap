use anchor_lang::error_code;
use constant_product_curve::CurveError;

#[error_code]
pub enum AmmError {
    #[msg("Invalid fee, max is 100")]
    InvalidFeeSet,

    #[msg("Pool is locked")]
    PoolLocked,

    #[msg("Zero balance")]
    ZeroBalance,

    #[msg("Invalid authority")]
    InvalidAuthority,

    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Invalid precision")]
    InvalidPrecision,

    #[msg("Overflow")]
    Overflow,

    #[msg("Underflow")]
    Underflow,

    #[msg("Invalid fee")]
    InvalidFee,

    #[msg("Insufficient balance")]
    InsufficientBalance,

    #[msg("Slippage limit exceeded")]
    SlippageExceeded,

    #[msg("Invalid input mint token")]
    InvalidInputMint,
}

impl From<CurveError> for AmmError {
    fn from(error: CurveError) -> AmmError {
        match error {
            CurveError::InvalidPrecision => AmmError::InvalidPrecision,
            CurveError::Overflow => AmmError::Overflow,
            CurveError::Underflow => AmmError::Underflow,
            CurveError::InvalidFeeAmount => AmmError::InvalidFee,
            CurveError::InsufficientBalance => AmmError::InsufficientBalance,
            CurveError::ZeroBalance => AmmError::ZeroBalance,
            CurveError::SlippageLimitExceeded => AmmError::SlippageExceeded,
        }
    }
}
