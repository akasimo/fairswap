import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";

import { createMint, createAccount, mintTo, getAssociatedTokenAddress, getAccount, createAssociatedTokenAccount } from "@solana/spl-token"
import { PublicKey, Commitment, Keypair } from "@solana/web3.js"

const commitment: Commitment = "confirmed";

// Helpers
export const confirmTx = async (signature: string) => {
    const latestBlockhash = await anchor.getProvider().connection.getLatestBlockhash();
    await anchor.getProvider().connection.confirmTransaction(
        {
            signature,
            ...latestBlockhash,
        },
        commitment
    )
}

export const confirmTxs = async (signatures: string[]) => {
    await Promise.all(signatures.map(confirmTx))
}

export const newMintToAta = async (connection, minter: Keypair, amount): Promise<{ mint: PublicKey, ata: PublicKey }> => {
    const mint = await createMint(connection, minter, minter.publicKey, null, 6)
    // await getAccount(connection, mint, commitment)
    const ata = await createAccount(connection, minter, mint, minter.publicKey)
    const signature = await mintTo(connection, minter, mint, ata, minter, amount)
    await confirmTx(signature)
    return {
        mint,
        ata
    }
}

export async function fetchTokenBalances(
    connection: anchor.web3.Connection,
    userPublicKey: PublicKey,
    mintX: PublicKey,
    mintY: PublicKey
): Promise<{ balanceX: BN, balanceY: BN }> {
    try {
        // Get the associated token accounts for the user
        const userAtaX = await getAssociatedTokenAddress(mintX, userPublicKey);
        const userAtaY = await getAssociatedTokenAddress(mintY, userPublicKey);

        // Fetch the account info for both token accounts
        const [accountX, accountY] = await Promise.all([
            getAccount(connection, userAtaX),
            getAccount(connection, userAtaY)
        ]);

        // Return the balances as BN
        return {
            balanceX: new BN(accountX.amount.toString()),
            balanceY: new BN(accountY.amount.toString())
        };
    } catch (error) {
        console.error("Error fetching token balances:", error);
        throw error;
    }
}

export async function logBalances(userPublicKey: PublicKey, operation: string, mint_x: PublicKey, mint_y: PublicKey) {
    const connection = anchor.getProvider().connection;
    const balances = await fetchTokenBalances(connection, userPublicKey, mint_x, mint_y);
    console.log(`Balances after ${operation}:`);
    console.log(`  X: ${balances.balanceX.toString()}`);
    console.log(`  Y: ${balances.balanceY.toString()}`);
}

export async function createAndFundATA(
    connection: anchor.web3.Connection,
    payer: Keypair,
    mint: PublicKey,
    owner: PublicKey,
    amount: number
): Promise<PublicKey> {
    // Get the ATA address
    const ata = await getAssociatedTokenAddress(mint, owner);

    try {
        // Create the ATA
        await createAssociatedTokenAccount(
            connection,
            payer,
            mint,
            owner
        );
    } catch (error) {
        // If the account already exists, we can ignore this error
        if (!(error instanceof Error) || !error.message.includes("already in use")) {
            throw error;
        }
    }

    // Mint tokens to the ATA
    if (amount > 0) {
        await mintTo(
            connection,
            payer,
            mint,
            ata,
            payer,
            amount
        );
    }

    // Get and log the balance
    const tokenAccount = await getAccount(connection, ata);
    console.log(`ATA ${ata.toBase58()} balance: ${tokenAccount.amount.toString()}`);

    return ata;
}
