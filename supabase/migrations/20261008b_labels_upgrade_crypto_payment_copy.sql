-- Owner, 2026-10-08 (relayed by PM): honest crypto-payment copy on /upgrade. Two NEW keys, five locales:
--   UPGRADE_CRYPTO_NETWORKS_NOTE  under the Pro plan price: what to pay in, and the networks.
--   UPGRADE_CRYPTO_CHECKOUT_NOTE  under the pay button: what happens at checkout.
-- The existing UPGRADE_METHOD_CRYPTO_NOTE ("use the same email as your account") is unchanged and now sits ABOVE the pay button.
-- Not said, by the owner's order: anonymous, decentralized, a gas figure, instant unlock, savings claims, "half the market cost".
--
-- The English text is the owner's wording. The network list is BoomFi's documented set (docs.boomfi.xyz/pricing/networks-and-currencies)
-- minus Ton and Bitcoin; it has NOT been checked against the real BoomFi checkout page (no test-mode link was available to Dev):
-- any network the checkout does not show must be removed from all five rows before release.
-- ar/ko/ru/zh are MACHINE-TRANSLATED and not native-reviewed. Network and token names stay in Latin script.
--
-- NOT APPLIED. Production write needs the owner's word; the dev section is commented out (apply one section at a time, to dev only
-- when QA says no test pass is running). The English default already lives in lib/labelDefaults.en.json, so an unapplied migration
-- shows English in every locale rather than a missing label.
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev, wdtjhrilakoitfcezxpx).

insert into lhq_labels (key, locale, value) values
('UPGRADE_CRYPTO_NETWORKS_NOTE','en','Pay in USDT or USDC. Send it on the network you prefer: Solana, Base, Arbitrum, Polygon, Ethereum, Tron or BNB Chain.'),
('UPGRADE_CRYPTO_NETWORKS_NOTE','ar','ادفع بعملة USDT أو USDC. أرسلها عبر الشبكة التي تفضلها: Solana أو Base أو Arbitrum أو Polygon أو Ethereum أو Tron أو BNB Chain.'),
('UPGRADE_CRYPTO_NETWORKS_NOTE','ko','USDT 또는 USDC로 결제하세요. 원하는 네트워크로 보내시면 됩니다: Solana, Base, Arbitrum, Polygon, Ethereum, Tron 또는 BNB Chain.'),
('UPGRADE_CRYPTO_NETWORKS_NOTE','ru','Оплатите в USDT или USDC. Отправьте на удобной вам сети: Solana, Base, Arbitrum, Polygon, Ethereum, Tron или BNB Chain.'),
('UPGRADE_CRYPTO_NETWORKS_NOTE','zh','使用 USDT 或 USDC 支付。可通过您偏好的网络发送：Solana、Base、Arbitrum、Polygon、Ethereum、Tron 或 BNB Chain。'),
('UPGRADE_CRYPTO_CHECKOUT_NOTE','en','You''ll enter your name and email at checkout. We never see or store your card details, because you pay on-chain through BoomFi. Network fees are set by the network you choose.'),
('UPGRADE_CRYPTO_CHECKOUT_NOTE','ar','ستُدخل اسمك وبريدك الإلكتروني عند الدفع. لا نرى بيانات بطاقتك ولا نخزنها، لأنك تدفع على السلسلة عبر BoomFi. تحدد الشبكة التي تختارها رسوم الشبكة.'),
('UPGRADE_CRYPTO_CHECKOUT_NOTE','ko','결제 시 이름과 이메일을 입력하게 됩니다. BoomFi를 통해 온체인으로 결제하므로 카드 정보를 보거나 저장하지 않습니다. 네트워크 수수료는 선택한 네트워크에서 정해집니다.'),
('UPGRADE_CRYPTO_CHECKOUT_NOTE','ru','При оплате вы введёте имя и электронную почту. Мы не видим и не храним данные вашей карты, потому что вы платите в блокчейне через BoomFi. Комиссии сети устанавливает выбранная вами сеть.'),
('UPGRADE_CRYPTO_CHECKOUT_NOTE','zh','结账时您需要输入姓名和电子邮箱。我们不会看到或存储您的银行卡信息，因为您是通过 BoomFi 在链上支付。网络费用由您选择的网络决定。')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: the same rows against lhq_dev_labels.
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('UPGRADE_CRYPTO_NETWORKS_NOTE','en','Pay in USDT or USDC. Send it on the network you prefer: Solana, Base, Arbitrum, Polygon, Ethereum, Tron or BNB Chain.'),
-- ('UPGRADE_CRYPTO_NETWORKS_NOTE','ar','ادفع بعملة USDT أو USDC. أرسلها عبر الشبكة التي تفضلها: Solana أو Base أو Arbitrum أو Polygon أو Ethereum أو Tron أو BNB Chain.'),
-- ('UPGRADE_CRYPTO_NETWORKS_NOTE','ko','USDT 또는 USDC로 결제하세요. 원하는 네트워크로 보내시면 됩니다: Solana, Base, Arbitrum, Polygon, Ethereum, Tron 또는 BNB Chain.'),
-- ('UPGRADE_CRYPTO_NETWORKS_NOTE','ru','Оплатите в USDT или USDC. Отправьте на удобной вам сети: Solana, Base, Arbitrum, Polygon, Ethereum, Tron или BNB Chain.'),
-- ('UPGRADE_CRYPTO_NETWORKS_NOTE','zh','使用 USDT 或 USDC 支付。可通过您偏好的网络发送：Solana、Base、Arbitrum、Polygon、Ethereum、Tron 或 BNB Chain。'),
-- ('UPGRADE_CRYPTO_CHECKOUT_NOTE','en','You''ll enter your name and email at checkout. We never see or store your card details, because you pay on-chain through BoomFi. Network fees are set by the network you choose.'),
-- ('UPGRADE_CRYPTO_CHECKOUT_NOTE','ar','ستُدخل اسمك وبريدك الإلكتروني عند الدفع. لا نرى بيانات بطاقتك ولا نخزنها، لأنك تدفع على السلسلة عبر BoomFi. تحدد الشبكة التي تختارها رسوم الشبكة.'),
-- ('UPGRADE_CRYPTO_CHECKOUT_NOTE','ko','결제 시 이름과 이메일을 입력하게 됩니다. BoomFi를 통해 온체인으로 결제하므로 카드 정보를 보거나 저장하지 않습니다. 네트워크 수수료는 선택한 네트워크에서 정해집니다.'),
-- ('UPGRADE_CRYPTO_CHECKOUT_NOTE','ru','При оплате вы введёте имя и электронную почту. Мы не видим и не храним данные вашей карты, потому что вы платите в блокчейне через BoomFi. Комиссии сети устанавливает выбранная вами сеть.'),
-- ('UPGRADE_CRYPTO_CHECKOUT_NOTE','zh','结账时您需要输入姓名和电子邮箱。我们不会看到或存储您的银行卡信息，因为您是通过 BoomFi 在链上支付。网络费用由您选择的网络决定。')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
