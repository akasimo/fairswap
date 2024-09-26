import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Fairswap } from "../target/types/fairswap";
import { SimpleAmm } from "../target/types/simple_amm";

import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID as tokenProgram, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token"
import { randomBytes } from "crypto"
import { assert, expect } from "chai"
import { ASSOCIATED_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";
import { buildTxConfirmOrLog, confirmTx, confirmTxs, createAndFundATA, logBalances, newMintToAta } from "./utils";

// herşeyi initle ve mintle
// 2 borsayı da initle

describe("fairswap compared to regular amm", () => {
    // Configure the client to use the local cluster.
    anchor.setProvider(anchor.AnchorProvider.env());

    const program_fairswap = anchor.workspace.Fairswap as Program<Fairswap>;
    const program_normal = anchor.workspace.SimpleAmm as Program<SimpleAmm>;

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
        user1_x_ata = await createAndFundATA(anchor.getProvider().connection, initializer, mint_x, user1.publicKey, 100000);
        user1_y_ata = await createAndFundATA(anchor.getProvider().connection, initializer, mint_y, user1.publicKey, 0);
        user2_x_ata = await createAndFundATA(anchor.getProvider().connection, initializer, mint_x, user2.publicKey, 100000);
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
    console.log("Fairswap program ID:", program_fairswap.programId.toBase58());
    console.log("Normal AMM program ID:", program_normal.programId.toBase58());

    it("Initialize", async () => {
        console.log(`Mint1 is ${mint_x.toBase58()}`);
        console.log(`Mint2 is ${mint_y.toBase58()}`);
        console.log(`Auth1 is ${auth_fairswap.toBase58()}`);
        console.log(`Auth2 is ${auth_normal.toBase58()}`);
        console.log(`Config1 is ${config_fairswap.toBase58()}`);
        console.log(`Config2 is ${config_normal.toBase58()}`);
        console.log(`VaultX1 is ${vault_x_ata_fairswap.toBase58()}`);
        console.log(`VaultY1 is ${vault_y_ata_fairswap.toBase58()}`);
        console.log(`VaultX2 is ${vault_x_ata_normal.toBase58()}`);
        console.log(`VaultY2 is ${vault_y_ata_normal.toBase58()}`);
        console.log(`Lp1 is ${mint_lp_fairswap.toBase58()}`);
        console.log(`Lp2 is ${mint_lp_normal.toBase58()}`);
        console.log(`initializer is ${initializer.publicKey.toBase58()}`);

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
        console.log("Fairswap initialization transaction signature", tx);
        await logBalances(initializer.publicKey, "initialization", mint_x, mint_y);

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
        console.log("Normal AMM initialization transaction signature", tx2);
    });

    const amountDepositX = 2e6;
    const amountDepositY = 2e6;
    const amountDepositLP = 2e6;

    it("Deposit to Both AMMs", async () => {
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
        // await logBalances(initializer.publicKey, "deposit", mint_x, mint_y);
        const tx2 = await program_normal.methods.deposit(
            new BN(amountDepositLP),
            new BN(amountDepositX),
            new BN(amountDepositY),
            new BN(Math.floor(new Date().getTime()/1000) + 600)
          )
          .accountsStrict({
            auth: auth_normal,
            user: initializer.publicKey,
            mintX: mint_x,
            mintY: mint_y,
            mintLp: mint_lp_normal,
            userX: initializer_x_ata,
            userY: initializer_y_ata,
            userLp: initializer_lp_ata_normal,
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
    });

    const amountSwapX = 2e4;
    const amountSwapYMin = 1e4;

    it("Swap X for Y", async () => {

        let balances_user1 = await logBalances(user1.publicKey, "of user1 before swap", mint_x, mint_y);
        let balances_user2 = await logBalances(user2.publicKey, "of user2 before swap", mint_x, mint_y);
        assert(balances_user1.balanceX.eq(balances_user2.balanceX), "User 1 should have equal X as user 2 before swap");
        assert(balances_user1.balanceY.eq(balances_user2.balanceY), "User 1 should have equal Y as user 2 before swap");

        const tx = await program_fairswap.methods.swap(
            mint_x,
            new BN(amountSwapX),
            new BN(amountSwapYMin)
        )
            .accountsPartial({
                auth: auth_fairswap,
                user: user1.publicKey,
                mintX: mint_x,
                mintY: mint_y,
                userAtaX: user1_x_ata,
                userAtaY: user1_y_ata,
                vaultX: vault_x_ata_fairswap,
                vaultY: vault_y_ata_fairswap,
                config: config_fairswap,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
                systemProgram: SystemProgram.programId
            })
            .signers([
                user1
            ]).rpc();
        await confirmTx(tx);
        console.log("Your transaction signature", tx);

        // Get and print logs for fairswap transaction
        const fairswapLogs = await anchor.getProvider().connection.getTransaction(tx, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
        });
        console.log("Fairswap transaction logs:");
        fairswapLogs?.meta?.logMessages?.forEach(log => console.log(log));


        // Normal amm transaction

        console.log("\nSwapping on normal amm");
        console.log("Withdraw from", vault_y_ata_normal.toBase58());
        console.log("Withdraw to", user2_y_ata.toBase58());
        console.log("Authority", auth_normal.toBase58());

        // Get and print mint addresses of from and deposit ATAs for normal AMM
        const connection = anchor.getProvider().connection;
        
        // For vault_y_ata_normal (withdraw from)
        const vaultYAccountInfo = await connection.getParsedAccountInfo(vault_y_ata_normal);
        if (vaultYAccountInfo.value && 'parsed' in vaultYAccountInfo.value.data) {
            const mintAddress = vaultYAccountInfo.value.data.parsed.info.mint;
            console.log("Vault Y ATA (deposit) mint:", mintAddress);
        }

        // For user2_y_ata (from ATA)
        const user2YAccountInfo = await connection.getParsedAccountInfo(user2_y_ata);
        if (user2YAccountInfo.value && 'parsed' in user2YAccountInfo.value.data) {
            const mintAddress = user2YAccountInfo.value.data.parsed.info.mint;
            console.log("User2 Y ATA (from) mint:", mintAddress);
        }


        const ix = await program_normal.methods
            .swap(
                true,
                new BN(amountSwapX),
                new BN(amountSwapYMin),
                new BN(Math.floor(new Date().getTime()/1000) + 600)
            )
                .accountsPartial({
                    auth: auth_normal,
                    user: user2.publicKey,
                    mintX: mint_x,
                    mintY: mint_y,
                    userX: user2_x_ata,
                    userY: user2_y_ata,
                    vaultX: vault_x_ata_normal,
                    vaultY: vault_y_ata_normal,
                    config: config_normal,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
                    systemProgram: SystemProgram.programId
                }).instruction();
            
        const txSignature = await buildTxConfirmOrLog(
            user2,
            ix,
            program_normal,
            "swap"
          )
        // try { 
        //     tx2 = await program_normal.methods.swap(
        //         true,
        //         new BN(amountSwapX),
        //         new BN(amountSwapYMin),
        //         new BN(Math.floor(new Date().getTime()/1000) + 600)
        //     )
        //         .accountsPartial({
        //             auth: auth_normal,
        //             user: user2.publicKey,
        //             mintX: mint_x,
        //             mintY: mint_y,
        //             userX: user2_x_ata,
        //             userY: user2_y_ata,
        //             vaultX: vault_x_ata_normal,
        //             vaultY: vault_y_ata_normal,
        //             config: config_normal,
        //             tokenProgram: TOKEN_PROGRAM_ID,
        //             associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
        //             systemProgram: SystemProgram.programId
        //         })
        //         .signers([
        //             user2
        //         ]).rpc();
        //     await confirmTx(tx2);
        //     console.log("Your transaction signature", tx2);
        // } catch (e) {
        //     console.log("Error", e);
        //     // Get and print logs for normal amm transaction
        //     const normalLogs = await anchor.getProvider().connection.getTransaction(tx2, {
        //         commitment: 'confirmed',
        //         maxSupportedTransactionVersion: 0
        //     });
        //     console.log("Normal AMM transaction logs:");
        //     normalLogs?.meta?.logMessages?.forEach(log => console.log(log));
        // }

        balances_user1 = await logBalances(user1.publicKey, "of user1 after swap", mint_x, mint_y);
        balances_user2 = await logBalances(user2.publicKey, "of user2 after swap", mint_x, mint_y);
        assert(balances_user1.balanceX.eq(balances_user2.balanceX), "User 1 should have equal X as user 2 after swap");
        assert(balances_user1.balanceY.eq(balances_user2.balanceY), "User 1 should have equal Y as user 2 after swap");
    });

    it("Self MEV Attack", async () => {
        // Log initial balances
        let balances_user1_before = await logBalances(user1.publicKey, "of user1 before self MEV in fairswap", mint_x, mint_y);
        let balances_user2_before = await logBalances(user2.publicKey, "of user2 before self MEV in normal amm", mint_x, mint_y);

        // Self MEV attack on Fairswap for user1
        const fairswapSwapAccounts = {
            auth: auth_fairswap,
            user: user1.publicKey,
            mintX: mint_x,
            mintY: mint_y,
            userAtaX: user1_x_ata,
            userAtaY: user1_y_ata,
            vaultX: vault_x_ata_fairswap,
            vaultY: vault_y_ata_fairswap,
            config: config_fairswap,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
            systemProgram: SystemProgram.programId
        };

        const ix1 = await program_fairswap.methods.swap(mint_x, new BN(15000), new BN(1000))
            .accountsPartial(fairswapSwapAccounts).instruction();
        const ix2 = await program_fairswap.methods.swap(mint_x, new BN(15000), new BN(1000))
            .accountsPartial(fairswapSwapAccounts).instruction();
        const ix3 = await program_fairswap.methods.swap(mint_y, new BN(30000), new BN(1000))
            .accountsPartial(fairswapSwapAccounts).instruction();

        const fairswapTx = new anchor.web3.Transaction().add(ix1, ix2, ix3);
        const fairswapTxSignature = await anchor.web3.sendAndConfirmTransaction(
            program_fairswap.provider.connection,
            fairswapTx,
            [user1]
        );
        // console.log("Fairswap self MEV transaction signature", fairswapTxSignature);

        // Self MEV attack on Normal AMM for user2
        const normalSwapAccounts = {
            auth: auth_normal,
            user: user2.publicKey,
            mintX: mint_x,
            mintY: mint_y,
            userX: user2_x_ata,
            userY: user2_y_ata,
            vaultX: vault_x_ata_normal,
            vaultY: vault_y_ata_normal,
            config: config_normal,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
            systemProgram: SystemProgram.programId
        };

        const currentTimestamp = Math.floor(new Date().getTime() / 1000);
        const deadline = new BN(currentTimestamp + 600);

        const ix4 = await program_normal.methods.swap(true, new BN(15000), new BN(1000), deadline)
            .accountsPartial(normalSwapAccounts).instruction();
        const ix5 = await program_normal.methods.swap(true, new BN(15000), new BN(1000), deadline)
            .accountsPartial(normalSwapAccounts).instruction();
        const ix6 = await program_normal.methods.swap(false, new BN(30000), new BN(1000), deadline)
            .accountsPartial(normalSwapAccounts).instruction();

        const normalTx = new anchor.web3.Transaction().add(ix4, ix5, ix6);
        const normalTxSignature = await anchor.web3.sendAndConfirmTransaction(
            program_normal.provider.connection,
            normalTx,
            [user2]
        );
        console.log("Normal AMM self MEV transaction signature", normalTxSignature);

        // Log final balances and compare
        let balances_user1_after = await logBalances(user1.publicKey, "of user1 after self MEV", mint_x, mint_y);
        let balances_user2_after = await logBalances(user2.publicKey, "of user2 after self MEV", mint_x, mint_y);

        // console.log("User1 (Fairswap) balance changes:");
        // console.log(`X: ${balances_user1_after.balanceX.sub(balances_user1_before.balanceX)}`);
        // console.log(`Y: ${balances_user1_after.balanceY.sub(balances_user1_before.balanceY)}`);

        // console.log("User2 (Normal AMM) balance changes:");
        // console.log(`X: ${balances_user2_after.balanceX.sub(balances_user2_before.balanceX)}`);
        // console.log(`Y: ${balances_user2_after.balanceY.sub(balances_user2_before.balanceY)}`);

        // You can add assertions here to compare the results if needed
        // Assert that user1 (Fairswap) has less X than user2 (Normal AMM)
        assert(balances_user1_after.balanceX.lt(balances_user2_after.balanceX), "User1 (Fairswap) should have less X than User2 (Normal AMM)");

        // Calculate the difference in X balance
        const xDifference = balances_user2_after.balanceX.sub(balances_user1_after.balanceX);

        console.log(`User1 (Fairswap) has ${xDifference.toString()} less X tokens compared to User2 (Normal AMM) due to MEV protection.`);
    });
});