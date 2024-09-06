use crate::errors::AmmError;
// use crate::states::PoolData;
use crate::{assert_not_locked, states::Config};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{mint_to, transfer_checked, MintTo, TransferChecked},
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::assert_non_zero;
use constant_product_curve::ConstantProduct;

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub mint_x: InterfaceAccount<'info, Mint>,
    pub mint_y: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint_x,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_ata_x: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint_y,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_ata_y: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint_lp,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_ata_lp: InterfaceAccount<'info, TokenAccount>,

    #[account(
        associated_token::mint = mint_x,
        associated_token::authority = config,
        associated_token::token_program = token_program,
    )]
    pub vault_x: InterfaceAccount<'info, TokenAccount>,

    #[account(
        associated_token::mint = mint_y,
        associated_token::authority = config,
        associated_token::token_program = token_program,
    )]
    pub vault_y: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"mint_lp", config.key().as_ref()],
        bump = config.lp_bump,
        // mint::authority = config,
        // mint::decimals = 6,
        // mint::freeze_authority = config,
        // mint::token_program = token_program,
    )]
    pub mint_lp: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [b"config".as_ref(), mint_x.key().as_ref(), mint_y.key().as_ref(), config.seed.to_le_bytes().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    // #[account(
    //     mut,
    //     seeds = [b"pooldata", config.key().as_ref()],
    //     bump = pooldata.bump,
    // )]
    // pooldata: Account<'info, PoolData>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> Deposit<'info> {
    pub fn deposit(&mut self, amount: u64, max_x: u64, max_y: u64) -> Result<()> {
        msg!("Starting deposit");
        require!(!self.config.locked, AmmError::PoolLocked);
        assert_non_zero!([amount, max_x, max_y]);
        assert_not_locked!(self);
        // let mut is_initialization = false;
        let (x, y) = match self.mint_lp.supply == 0
            && self.vault_x.amount == 0
            && self.vault_y.amount == 0
        {
            true => {
                // is_initialization = true;
                (max_x, max_y)
            }
            false => {
                let amounts = ConstantProduct::xy_deposit_amounts_from_l(
                    self.vault_x.amount,
                    self.vault_y.amount,
                    self.mint_lp.supply,
                    amount,
                    6,
                )
                .map_err(AmmError::from)?;
                (amounts.x, amounts.y)
            }
        };

        // if is_initialization {
        //     self.pooldata.last_slot = Clock::get()?.slot;
        //     self.pooldata.buying_x_high = calculate_limit_price(x, y, self.pooldata.precision)?;
        //     self.pooldata.buying_y_high = calculate_limit_price(y, x, self.pooldata.precision)?;
        //     // self.pooldata.price_x_low = (x as u128)
        //     //     .checked_mul(10u128.checked_pow(self.pooldata.precision as u32).ok_or(AmmError::InvalidPrecision)? as u128)
        //     //     .ok_or(AmmError::Overflow)?
        //     //     .checked_div(y as u128)
        //     //     .ok_or(AmmError::Overflow)?;
        //     // self.pooldata.price_y_low = (y as u128)
        //     //     .checked_mul(10u128.checked_pow(self.pooldata.precision as u32).ok_or(AmmError::InvalidPrecision)? as u128)
        //     //     .ok_or(AmmError::Overflow)?
        //     //     .checked_div(x as u128)
        //     //     .ok_or(AmmError::Overflow)?;
        //     // x vault:100, y: 10 => x fiyatı: x/y = 100/10 = 10. bu en kötü fiyat. yani x alırken 10dan fazla alamayacak
        // }

        msg!("Checking slippage");
        require!(x <= max_x && y <= max_y, AmmError::SlippageExceeded);

        msg!("Depositing token x");
        self.deposit_tokens(true, x)?;

        msg!("Depositing token y");
        self.deposit_tokens(false, y)?;

        msg!("Minting LP tokens");
        self.mint_lp_token(amount)
    }

    pub fn deposit_tokens(&mut self, is_x: bool, amount: u64) -> Result<()> {
        msg!("deposit tokens func started");
        // let decimals: u8 = 6;
        let (mint, decimals, vault, ata) = match is_x {
            true => (
                self.mint_x.to_account_info(),
                self.mint_x.decimals,
                self.vault_x.to_account_info(),
                self.user_ata_x.to_account_info(),
            ),
            false => (
                self.mint_y.to_account_info(),
                self.mint_y.decimals,
                self.vault_y.to_account_info(),
                self.user_ata_y.to_account_info(),
            ),
        };
        msg!("Creating transfer checked accounts");
        let accounts = TransferChecked {
            from: ata,
            to: vault,
            authority: self.user.to_account_info(),
            mint: mint,
        };

        let ctx = CpiContext::new(self.token_program.to_account_info(), accounts);
        msg!("Transferring tokens");
        transfer_checked(ctx, amount, decimals)?;

        Ok(())
    }

    pub fn mint_lp_token(&mut self, amount: u64) -> Result<()> {
        let accounts = MintTo {
            mint: self.mint_lp.to_account_info(),
            authority: self.config.to_account_info(),
            to: self.user_ata_lp.to_account_info(),
        };

        let binding_mint_x = self.mint_x.to_account_info().key();
        let binding_mint_y = self.mint_y.to_account_info().key();
        let binding_seed = self.config.seed.to_le_bytes();
        let seeds = &[
            &b"amm"[..],
            &binding_mint_x.as_ref(),
            &binding_mint_y.as_ref(),
            &binding_seed.as_ref(),
            &[self.config.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let ctx = CpiContext::new_with_signer(
            self.token_program.to_account_info(),
            accounts,
            signer_seeds,
        );

        mint_to(ctx, amount)
    }
}
