use crate::assert_non_zero;
use crate::errors::AmmError;
use crate::{
    assert_not_locked,
    helpers::calculate_limit_price,
    states::{Config, PoolData},
};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{transfer_checked, TransferChecked},
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use constant_product_curve::{ConstantProduct, LiquidityPair};

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub mint_x: Box<InterfaceAccount<'info, Mint>>,
    pub mint_y: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: this is safe
    #[account(
        seeds = [b"auth"],
        bump = config.bump_auth,
    )]
    pub auth: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint_x,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_ata_x: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint_y,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_ata_y: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint_x,
        associated_token::authority = auth,
        associated_token::token_program = token_program,
    )]
    pub vault_x: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint_y,
        associated_token::authority = auth,
        associated_token::token_program = token_program,
    )]
    pub vault_y: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"mint_lp", config.key().as_ref()],
        bump,
    )]
    pub mint_lp: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        has_one = mint_x,
        has_one = mint_y,
        seeds = [b"config".as_ref(), mint_x.key().as_ref(), mint_y.key().as_ref(), config.seed.to_le_bytes().as_ref()],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, Config>>,

    #[account(
        mut,
        seeds = [b"pooldata", config.key().as_ref()],
        bump
    )]
    pub pooldata: Box<Account<'info, PoolData>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> Swap<'info> {
    pub fn swap(
        &mut self,
        mint_deposit: Pubkey,
        amount_in: u64,
        amount_out_min: u64,
    ) -> Result<()> {
        assert_not_locked!(self.config.locked);
        assert_non_zero!([amount_in, amount_out_min]);

        let mut curve = ConstantProduct::init(
            self.vault_x.amount,
            self.vault_y.amount,
            self.mint_lp.supply,
            self.config.fee,
            None,
        )
        .map_err(AmmError::from)?;

        let (p, mint_withdraw, is_buying_x) = match mint_deposit {
            m if m == self.mint_x.key() => (LiquidityPair::X, self.mint_y.key(), false),
            m if m == self.mint_y.key() => (LiquidityPair::Y, self.mint_x.key(), true),
            _ => return Err(AmmError::InvalidInputMint.into()),
        };
        msg!("is_buying_x: {}", is_buying_x);
        let res = curve
            .swap(p, amount_in, amount_out_min)
            .map_err(AmmError::from)?;

        let mut current_ratio =
            calculate_limit_price(res.deposit, res.withdraw, self.pooldata.precision)?;
        msg!("current_ratio: {}", current_ratio);

        let current_slot = Clock::get()?.slot;
        if current_slot != self.pooldata.last_slot {
            msg!("Updating pool data");
            self.pooldata.last_slot = current_slot;
            if is_buying_x {
                self.pooldata.buying_x_high = Some(current_ratio);
                self.pooldata.buying_y_high = Some(calculate_limit_price(
                    self.vault_x.amount,
                    self.vault_y.amount,
                    self.pooldata.precision,
                )?);
                msg!("updated buying_x_high");
            } else {
                self.pooldata.buying_x_high = Some(calculate_limit_price(
                    self.vault_y.amount,
                    self.vault_x.amount,
                    self.pooldata.precision,
                )?);
                self.pooldata.buying_y_high = Some(current_ratio);
                msg!("updated buying_y_high");
            }
        }
        // msg!("current_slot: {}", current_slot);

        // Determine the price limit based on whether we are buying X or Y
        if is_buying_x {
            if current_ratio > self.pooldata.buying_x_high.unwrap() {
                self.pooldata.buying_x_high = Some(current_ratio);
                msg!("updated buying_x_high");
            } else if current_ratio < self.pooldata.buying_x_high.unwrap() {
                current_ratio = self.pooldata.buying_x_high.unwrap();
                msg!("current_ratio: {}", current_ratio);
            }
        } else {
            if current_ratio > self.pooldata.buying_y_high.unwrap() {
                self.pooldata.buying_y_high = Some(current_ratio);
                msg!("updated buying_y_high");
            } else if current_ratio < self.pooldata.buying_y_high.unwrap() {
                current_ratio = self.pooldata.buying_y_high.unwrap();
                msg!("current_ratio: {}", current_ratio);
            }
        }

        msg!("og withdraw amount: {}", res.withdraw);
        let withdraw_amount = (res.deposit as u128)
            .checked_mul(
                10u128
                    .checked_pow(self.pooldata.precision as u32)
                    .ok_or(AmmError::InvalidPrecision)?,
            )
            .ok_or(AmmError::Overflow)?
            .checked_div(current_ratio)
            .ok_or(AmmError::Overflow)? as u64;
        // let withdraw_amount = current_ratio
        //     .checked_mul(res.deposit as u128)
        //     .ok_or(AmmError::Overflow)?
        //     .checked_div(
        //         10u128
        //             .checked_pow(self.pooldata.precision as u32)
        //             .ok_or(AmmError::InvalidPrecision)?,
        //     )
        //     .ok_or(AmmError::Overflow)? as u64;
        msg!("withdraw_amount: {}", withdraw_amount);

        require!(
            withdraw_amount >= amount_out_min,
            AmmError::SlippageExceeded
        );
        assert_non_zero!([res.deposit, withdraw_amount]);

        self.deposit_token(mint_deposit, res.deposit)?;
        self.withdraw_token(mint_withdraw, withdraw_amount)?;
        Ok(())
    }

    pub fn deposit_token(&mut self, mint_deposit: Pubkey, amount: u64) -> Result<()> {
        let mint;
        let (from, to) = match mint_deposit {
            m if m == self.mint_x.key() => {
                mint = self.mint_x.clone();
                (
                    self.user_ata_x.to_account_info(),
                    self.vault_x.to_account_info(),
                )
            }
            m if m == self.mint_y.key() => {
                mint = self.mint_y.clone();
                (
                    self.user_ata_y.to_account_info(),
                    self.vault_y.to_account_info(),
                )
            }
            _ => return Err(AmmError::InvalidInputMint.into()),
        };

        let account = TransferChecked {
            from,
            mint: mint.to_account_info(),
            to,
            authority: self.user.to_account_info(),
        };

        let ctx = CpiContext::new(self.token_program.to_account_info(), account);

        transfer_checked(ctx, amount, 6)
    }

    pub fn withdraw_token(&mut self, mint_withdraw: Pubkey, amount: u64) -> Result<()> {
        let mint;
        let (from, to) = match mint_withdraw {
            m if m == self.mint_x.key() => {
                mint = self.mint_x.clone();
                (
                    self.vault_x.to_account_info(),
                    self.user_ata_x.to_account_info(),
                )
            }
            m if m == self.mint_y.key() => {
                mint = self.mint_y.clone();
                (
                    self.vault_y.to_account_info(),
                    self.user_ata_y.to_account_info(),
                )
            }
            _ => return Err(AmmError::InvalidInputMint.into()),
        };

        let account = TransferChecked {
            from,
            mint: mint.to_account_info(),
            to,
            authority: self.auth.to_account_info(), // authority: self.config.to_account_info()
        };

        // let binding_mint_x = self.mint_x.to_account_info().key();
        // let binding_mint_y = self.mint_y.to_account_info().key();
        // let binding_seed = self.config.seed.to_le_bytes();
        // let seeds: &[&[u8]; 5] = &[
        //     &b"amm"[..],
        //     &binding_mint_x.as_ref(),
        //     &binding_mint_y.as_ref(),
        //     &binding_seed.as_ref(),
        //     &[self.config.bump],
        // ];
        let seeds = &[&b"auth"[..], &[self.config.bump_auth]];
        let signer_seeds = &[&seeds[..]];

        let ctx = CpiContext::new_with_signer(
            self.token_program.to_account_info(),
            account,
            signer_seeds,
        );
        transfer_checked(ctx, amount, 6)
    }
}
