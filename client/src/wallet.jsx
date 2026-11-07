import { createContext, useContext } from 'react';

// Shares the shopper's Pal Points wallet with any component that wants to show a balance or open the wallet.
export const WalletContext = createContext({ wallet: null, openWallet: () => {} });
export const useWallet = () => useContext(WalletContext);
