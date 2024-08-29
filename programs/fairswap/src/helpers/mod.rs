use anchor_lang::prelude::*;
use crate::errors::AmmError;

#[macro_export]
macro_rules! assert_non_zero {
    ($array:expr) => {
        if $array.contains(&0u64) {
            return err!(AmmError::ZeroBalance)
        }
    };
}

#[macro_export]
macro_rules! assert_has_authority {
    ($x:expr) => {
        match $x.config.authority {
            Some(authority) => {
                require_keys_eq!(authority, $x.user.key)(, AmmError::InvalidAuthority)
            },
            None => return err!(AmmError::Unauthorized)
        }
    };
}

#[macro_export]
macro_rules! assert_not_locked {
    ($x:expr) => {
        if ($x.config.locked == true) {
            return err!(AmmError::PoolLocked)
        }
    };
}



pub fn calculate_limit_price(amount1: u64, amount2: u64, precision: u8) -> Result<u128> {
    let result = (amount1 as u128)
        .checked_mul(10u128.checked_pow(precision as u32).ok_or(AmmError::InvalidPrecision)?)
        .ok_or(AmmError::Overflow)?
        .checked_div(amount2 as u128)
        .ok_or(AmmError::Overflow)?;
    Ok(result)
}