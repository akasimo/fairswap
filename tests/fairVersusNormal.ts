import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Fairswap } from "../target/types/fairswap";

import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID as tokenProgram, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token"
import { randomBytes } from "crypto"
import { assert, expect } from "chai"
import { ASSOCIATED_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";
import { confirmTx, confirmTxs, createAndFundATA, logBalances, newMintToAta } from "./utils";
import { SimpleAmm } from "../target/types/simple_amm";

// herşeyi initle ve mintle
// 2 borsayı da initle

describe("fairswap compared to regular amm", () => {
    // Configure the client to use the local cluster.
    anchor.setProvider(anchor.AnchorProvider.env());

    const program_fairswap = anchor.workspace.Fairswap as Program<Fairswap>;
    const program_normal = anchor.workspace.Fairswap as Program<SimpleAmm>;

    const [initializer, user1, user2] = [new Keypair(), new Keypair(), new Keypair()];

    // Random seed
    const seed = new BN(randomBytes(8));
    const auth_fairswap = PublicKey.findProgramAddressSync([Buffer.from("auth")], program_fairswap.programId)[0];
    const auth_normal = PublicKey.findProgramAddressSync([Buffer.from("auth")], program_normal.programId)[0];

    let mint_x: PublicKey;
    let mint_y: PublicKey;
    let mint_lp_fairswap: PublicKey;
    let mint_lp_normal: PublicKey;
    let config_fairswap: PublicKey;
    let config_normal: PublicKey;
    let initializer_x_ata: PublicKey;
    let initializer_y_ata: PublicKey;
    let initializer_lp_ata_fairswap: PublicKey;
    let initializer_lp_ata_normal: PublicKey;
    let user1_x_ata: PublicKey;
    let user1_y_ata: PublicKey;
    let user2_x_ata: PublicKey;
    let user2_y_ata: PublicKey;
    let vault_x_ata_fairswap: PublicKey;
    let vault_y_ata_fairswap: PublicKey;
    let vault_lp_ata_fairswap: PublicKey;
    let vault_x_ata_normal: PublicKey;
    let vault_y_ata_normal: PublicKey;
    let vault_lp_ata_normal: PublicKey;

    // ATAs
    it("Airdrop", async () => {
        await Promise.all([initializer, user1, user2].map(async (k) => {
            return await anchor.getProvider().connection.requestAirdrop(k.publicKey, 100 * anchor.web3.LAMPORTS_PER_SOL)
        })).then(confirmTxs);
    });

    // Create mints and ATAs
    it("Create mints, tokens and ATAs", async () => {
        let [u1, u2] = await Promise.all([initializer, initializer].map(async (a) => { return await newMintToAta(anchor.getProvider().connection, a, 1e9) }))
        mint_x = u1.mint;
        mint_y = u2.mint;
        initializer_x_ata = u1.ata;
        initializer_y_ata = u2.ata;

        //user currently not used but creating for future tests
        user1_x_ata = await createAndFundATA(anchor.getProvider().connection, initializer, mint_x, user1.publicKey, 5000);
        user1_y_ata = await createAndFundATA(anchor.getProvider().connection, initializer, mint_y, user1.publicKey, 0);
        user2_x_ata = await createAndFundATA(anchor.getProvider().connection, initializer, mint_x, user2.publicKey, 5000);
        user2_y_ata = await createAndFundATA(anchor.getProvider().connection, initializer, mint_y, user2.publicKey, 0);

        // create config and lp mint for fairswap
        config_fairswap = PublicKey.findProgramAddressSync([Buffer.from("config"), mint_x.toBuffer(), mint_y.toBuffer(), seed.toBuffer().reverse()], program_fairswap.programId)[0];
        mint_lp_fairswap = PublicKey.findProgramAddressSync([Buffer.from("mint_lp"), config_fairswap.toBuffer()], program_fairswap.programId)[0];
        initializer_lp_ata_fairswap = await getAssociatedTokenAddress(mint_lp_fairswap, initializer.publicKey, false, tokenProgram);

        // Create take ATAs
        vault_x_ata_fairswap = await getAssociatedTokenAddress(mint_x, auth_fairswap, true, tokenProgram);
        vault_y_ata_fairswap = await getAssociatedTokenAddress(mint_y, auth_fairswap, true, tokenProgram);
        vault_lp_ata_fairswap = await getAssociatedTokenAddress(mint_lp_fairswap, auth_fairswap, true, tokenProgram);

        // create config and lp mint for normal amm
        config_normal = PublicKey.findProgramAddressSync([Buffer.from("config"), seed.toBuffer().reverse()], program_normal.programId)[0];
        mint_lp_normal = PublicKey.findProgramAddressSync([Buffer.from("lp"), config_normal.toBuffer()], program_normal.programId)[0];
        initializer_lp_ata_normal = await getAssociatedTokenAddress(mint_lp_normal, initializer.publicKey, false, tokenProgram);

        // Create take ATAs
        vault_x_ata_normal = await getAssociatedTokenAddress(mint_x, auth_normal, true, tokenProgram);
        vault_y_ata_normal = await getAssociatedTokenAddress(mint_y, auth_normal, true, tokenProgram);
        vault_lp_ata_normal = await getAssociatedTokenAddress(mint_lp_normal, auth_normal, true, tokenProgram);
    })

    it("Initialize", async () => {
        const tx = await program_fairswap.methods.initialize(
            seed,
            0
        )
            .accountsPartial({
                admin: initializer.publicKey,
                auth: auth_fairswap,
                mintX: mint_x,
                mintY: mint_y,
                vaultX: vault_x_ata_fairswap,
                vaultY: vault_y_ata_fairswap,
                config: config_fairswap,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
                systemProgram: SystemProgram.programId
            })
            .signers([
                initializer
            ]).rpc();
        await confirmTx(tx);
        console.log("Your transaction signature", tx);
        // await logBalances(initializer.publicKey, "initialization", mint_x, mint_y);

        const tx2 = await program_normal.methods.initialize(
            seed,
            0,
            initializer.publicKey
        )
            .accountsPartial({
                auth: auth_normal,
                initializer: initializer.publicKey,
                mintX: mint_x,
                mintY: mint_y,
                vaultX: vault_x_ata_normal,
                vaultY: vault_y_ata_normal,
                config: config_normal,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
                systemProgram: SystemProgram.programId
            })
            .signers([
                initializer
            ]).rpc();
        await confirmTx(tx2);
        console.log("Your transaction signature", tx2);
    });

    const amountDepositX = 2e5;
    const amountDepositY = 2e5;
    const amountDepositLP = 3e5;

    xit("Deposit to Both AMMs", async () => {
        const tx = await program_fairswap.methods.deposit(
            new BN(amountDepositLP),
            new BN(amountDepositX),
            new BN(amountDepositY)
        )
            .accountsStrict({
                user: initializer.publicKey,
                auth: auth_fairswap,
                mintX: mint_x,
                mintY: mint_y,
                userAtaX: initializer_x_ata,
                userAtaY: initializer_y_ata,
                userAtaLp: initializer_lp_ata_fairswap,
                vaultX: vault_x_ata_fairswap,
                vaultY: vault_y_ata_fairswap,
                mintLp: mint_lp_fairswap,
                config: config_fairswap,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
                systemProgram: SystemProgram.programId
            })
            .signers([
                initializer
            ]).rpc();
        await confirmTx(tx);
        console.log("Your deposit transaction signature", tx);
        await logBalances(initializer.publicKey, "deposit", mint_x, mint_y);
    });

    xit("Swap X for Y", async () => {
        const tx = await program_fairswap.methods.swap(
            mint_x,
            new BN(5000),
            new BN(6000)
        )
            .accountsPartial({
                auth: auth_fairswap,
                user: initializer.publicKey,
                mintX: mint_x,
                mintY: mint_y,
                userAtaX: initializer_x_ata,
                userAtaY: initializer_y_ata,
                vaultX: vault_x_ata_fairswap,
                vaultY: vault_y_ata_fairswap,
                config: config_fairswap,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
                systemProgram: SystemProgram.programId
            })
            .signers([
                initializer
            ]).rpc();
        await confirmTx(tx);
        console.log("Your transaction signature", tx);
        const currentSlot = await anchor.getProvider().connection.getSlot();
        console.log(`Current slot is ${currentSlot}`);
        await logBalances(initializer.publicKey, "swap X for Y", mint_x, mint_y);
    });

    xit("Swap Y for X", async () => {
        const tx = await program_fairswap.methods.swap(
            mint_y,
            new BN(7330),
            new BN(4500)
        )
            .accountsPartial({
                auth: auth_fairswap,
                user: initializer.publicKey,
                mintX: mint_x,
                mintY: mint_y,
                userAtaX: initializer_x_ata,
                userAtaY: initializer_y_ata,
                vaultX: vault_x_ata_fairswap,
                vaultY: vault_y_ata_fairswap,
                config: config_fairswap,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
                systemProgram: SystemProgram.programId
            })
            .signers([
                initializer
            ]).rpc();
        await confirmTx(tx);
        console.log("Your transaction signature", tx);
        const currentSlot = await anchor.getProvider().connection.getSlot();
        console.log(`Current slot is ${currentSlot}`);
        await logBalances(initializer.publicKey, "swap Y for X", mint_x, mint_y);
    });
});

