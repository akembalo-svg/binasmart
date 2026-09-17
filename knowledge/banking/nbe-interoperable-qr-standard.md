---
url: "https://nbe.gov.et/wp-content/uploads/2024/04/Interoperable-QR-Standard.pdf"
title: "National Bank of Ethiopia — interoperable-qr-standard"
source_name: "National Bank of Ethiopia"
section: "payments"
lang: "en"
text_source: "pdf"
status: "live"
fetchedAt: "2026-09-16"
lastChecked: "2026-09-17"
contentHash: "d639477f9fb7ca3e99f76de0d684dca757f3cf49"
generated_by: "ops/packs/fetch-pack.js --pack banking"
packFormat: "2"
---

# National Bank of Ethiopia — interoperable-qr-standard

National Bank of Ethiopia — payments — interoperable-qr-standard.

በአማርኛ፦ የክፍያ ሥርዓት — interoperable-qr-standard። ይህ ገጽ ከኢትዮጵያ ብሔራዊ ባንክ ኦፊሴላዊ ድረ-ገጽ በእንግሊዝኛ የተወሰደ ነው። የወለድ መጠን፣ የአገልግሎት ክፍያ፣ ታሪፍና የምንዛሪ ተመን ያለማስታወቂያ ይለወጣሉ። ይህ ገጽ ከላይ በተጠቀሰው ቀን ተቋሙ ባሳተመው መልኩ ነው። በማንኛውም ቁጥር ላይ ከመወሰንዎ በፊት ባንኩን ያረጋግጡ።

Source: https://nbe.gov.et/wp-content/uploads/2024/04/Interoperable-QR-Standard.pdf (official National Bank of Ethiopia page, in English), fetched 2026-09-16. Everything below is that page as the institution wrote it — every rate, fee, limit and condition is copied, not restated. Interest rates, fees, tariffs and exchange rates change, often without notice. This is the page exactly as the institution published it on the date above. Confirm with the bank before you act on any figure. BinaSmart is not a bank: this page is information, not advice, and nothing here opens an account, moves money or applies for anything.

STANDARD FOR
INTEROPERABLE QR CODE
PAYMENTS

Interoperable P2M Payments Using
QR Code

Interoperable P2M Payments Using QR Code

Table of Contents
Glossary ................................................................................................................................................................. 2

1.      Objective........................................................................................................................................................3

2.      Scope and Applicability ...............................................................................................................................3

3.      QR Code Transaction Flows .......................................................................................................................4

Static QR Code Flow ........................................................................................................................................5

Dynamic QR Flow..............................................................................................................................................6

4.      QR Specification Standard ......................................................................................................................... 8

Standard Template for QR Codes with Multiple Schemes Embedded ................................................... 8

Details of Data Objects within QR Standard ................................................................................................9

5.      QR Code Interoperability for In-Store Purchases .................................................................................18

6.      Roles and Responsibilities ......................................................................................................................... 19

Acquirers .......................................................................................................................................................... 19

Issuers .............................................................................................................................................................. 19

IPS ET QR Scheme ......................................................................................................................................... 20

Annexure A – Sample QR .................................................................................................................................. 21

Annexure B – Existing QR Codes in Ethiopia ................................................................................................ 22

Page | 1

Interoperable P2M Payments Using QR Code

Glossary
  Abbreviation                                         Description
 CRC              Cyclic Redundancy Check
                  EMVCo is the global technical body that facilitates the worldwide
 EMVCo            interoperability and acceptance of secure payment transactions.
 ET               Ethiopia (assumed based on context)
 IPS              Immediate Payment Service (assumed based on context)
 MAI              Merchant Account Information
 MCC              Merchant Category Code
 O2O              Offline-to-Online
 P2M              Peer-to-Merchant
 P2P              Peer-to-Peer
 PACS.008         A type of financial message format
 PAIN.013         Another type of financial message format
 PFI              Payload Format Indicator
 POI              Point of Initiation
 PSO/PSP          Payment System Operator/Payment Service Provider
 QR               Quick Response (in the context of QR Code)
 RTP              Request to Pay
 TTC              Transaction Type Code (assumed based on context)
 UPI              Unified Payments Interface (commonly used in India)

Page | 2

Interoperable P2M Payments Using QR Code

1. Objective
The aim of introducing this QR Standard is to foster an environment that promotes wider access to
and utilization of affordable acceptance methods for digital payments (specifically QR Codes), with
the ultimate goal of digitizing merchant payments through standardized and unified QR codes and
reduce the use of cash in the economy.

This standard is proposed keeping the following individual goals and principles in mind.

•   Reduce capital as well as transactional costs for mass adoption of digital payments.
    •   Devise a unified QR standard to support multi-scheme model (both domestic and
        international).
    •   Promote wider adoption of QR code for different types of electronic payments (in-store,
        ecommerce, bill presentment & payments).
    •   Provide an enabling environment to offer discounts & loyalty rewards using the QR code.
    •   Enable static and dynamic QRs at acceptance points.
    •   Harmonize the practices of QR placement at merchant locations.
    •   Encourage small and medium merchants for digital payments.
    •   Enable domestic payment schemes to enable QR Code payments.
    •   Allow authorized merchant aggregators/non-bank acquirers to enter into merchant acquiring
        business for the overall growth of QR acceptance ecosystem.

2. Scope and Applicability

This standard is based on the EMVCo standard and applicable to all Banks, Micro Finance Institutions,
Payment Instrument Issuers and PSO/PSPs in the country that are either offering or are desirous to
offer a P2M QR Code as a mechanism for merchant payments to their customers.

The EMVCo QR Code Specifications for Merchant Presented QR Code Payments1 is used, this provides
a standardized template for the generation of QR codes that will work consistently everywhere to
deliver convenient and reliable card and account-based payments, however, the EMVCo Standard
must be tailored to the Ethiopian context, that is the purpose of this document.

1
    https://www.emvco.com/specifications/emv-qr-code-specification-for-payment-systems-emv-
qrcps-merchant-presented-mode/

Page | 3

Interoperable P2M Payments Using QR Code

3. QR Code Transaction Flows

QR codes have revolutionized the way commerce takes place. This streamlined process usually
involves merchants generating QR codes with their details, consumers scanning these codes via a
mobile app to initiate transactions, the app sending transaction requests to the network, and the
network communicating the transaction outcome to both merchant and consumer. Below is a
standard sequence of events to do a QR transaction.

2

Within the domain of QR transactions, two fundamental types of QR codes play a pivotal role: static
and dynamic. These variations add a layer of versatility to the transaction process, each catering to
distinct needs. Understanding the contrast between static and dynamic QR codes is essential for
optimizing payment experiences. As we move forward, let's delve into the specifics of these two QR
code types and the unique advantages they offer in facilitating seamless transactions.

2
    Reference: EMV® QR Code Specification for Payment Systems Merchant-Presented Mode
Overview to EMV® QR Code Payment, Page 13

Page | 4

Interoperable P2M Payments Using QR Code

Static QR Code Flow

1.   Customer scans the QR code. At this stage the Issuing Bank Application displays the name of
        the Merchant, retrieved from the Merchant Label in the QR Code.
   2. Customer enters the Payment Amount.
   3. Customer's app sends a payment initiation message to the Issuer (Customer DFSP). The
        Issuer packages the payment message according to IPS ET Specifications, using information
        from the QR and Registry.
   4. The Issuer sends the Payment Message to IPS ET.
   5. IPS ET routes the payment request to the Merchant DFSP (Acquirer) based on the DFSP Swift
        Code in Tag 28.

Page | 5

Interoperable P2M Payments Using QR Code
   6. Acquirer (Merchant DFSP) performs Merchant and Payment Validations: It validates the
        incoming Payment. Validates that the Merchant Name is associated with the passed Account
        Number in its merchant registry.
   7.   The Acquirer responds with success if validations are successful.
   8. IPS ET confirms the payment to the Issuer and the Acquirer.
   9. Acquirer (Merchant DFSP) receives the confirmation of payment from IPS ET.
   10. Issuer notifies the Customer about the successful payment.
   11. Acquirer notifies the Merchant about the successful payment.

Dynamic QR Flow

1.   The customer presents at the Point of Sale (POS) for checkout, the customer notifies the
        Merchant about their intention to pay.

Page | 6

Interoperable P2M Payments Using QR Code
   2. The merchant calls the Merchant DFSP API to generate a QR code by providing it all relevant
        information necessary to generate the QR Code.
   3. Merchant DFSP (Acquirer) calls the IPS ET API to generate a QR code through the Centralized
        Service.
   4. IPS ET responds to the Acquirer with the generated QR code string.
   5. Acquirer (Merchant DFSP) responds to the Merchant with the generated QR code string and
        the QR code is displayed on the POS for scanning.
   6. Customer scans the QR code. At this stage the Issuing Bank Application displays the name of
        the Merchant, retrieved from the Merchant Label in the QR Code.
   7.   Customer enters the Payment Amount.
   8. Customer's app sends a payment initiation message to the Issuer (Customer DFSP). The
        Issuer packages the payment message according to IPS ET Specifications, using information
        from the QR and Registry.
   9. The Issuer sends the Payment Message to IPS ET.
   10. IPS ET routes the payment request to the Merchant DFSP (Acquirer) based on the DFSP Swift
        Code in Tag 28.
   11. Acquirer (Merchant DFSP) performs Merchant and Payment Validations: It validates the
        incoming Payment. Validates that the Merchant Name is associated with the passed Account
        Number in its merchant registry.
   12. The Acquirer responds with success if validations are successful.
   13. IPS ET confirms the payment to the Issuer and the Acquirer.
   14. Acquirer (Merchant DFSP) receives the confirmation of payment from IPS ET.
   15. Issuer notifies the Customer about the successful payment.
   16. Acquirer notifies the Merchant about the successful payment.

Page | 7

Interoperable P2M Payments Using QR Code

4. QR Specification Standard

The following outlines the guidelines for acquirers to create QR Codes for merchants and for issuers
to develop their applications accordingly. According to EMVCo, Tag IDs (02-25) are exclusively
allocated for international Payment Schemes, while tags 26 to 51 can be utilized by domestic
schemes. Therefore, Merchant Account Information for our standard inherited from EMVCo but
adapted to the Ethiopian Context is as follows.

ID                                Scheme Allocation
            02 – 03      Reserved for Visa
            04 – 05      Reserved for Mastercard
            06 – 08      Reserved for EMVCo
            09 – 10      Reserved for Discover
            11 – 12      Reserved for Amex
            13 – 14      Reserved for JCB
            15 – 16      Reserved for UnionPay
            17 – 25      Reserved for EMVCo
                         Reserved for additional payment networks or domestic schemes.
                             •   26 – 27 reserved for future use.
            26 – 51
                             •   28 – 30 reserved for IPS ET.
                             •   31 – 51 reserved for future use.
                   Table 1: Merchant Account Information Definition as per EMVCo

Standard Template for QR Codes with Multiple Schemes Embedded

•   The scheme identifier (first two digits of the MAI) will be issued by EthSwitch only to those
        authorized PSO/PSPs which are desirous to offer QR Codes for merchant payments in the
        country.
    •   The proposed template of Standard QR is placed below covering EMVCo Tag IDs, adjusting
        multiple payment schemes (international and domestic), newly reserved Tag ID for domestic
        schemes as well as reserved templates for future use.
    •   Participants can decide to include additional objects from EMVCo as per their design
        considerations and requirements. Reference can be made to the EMVCo QR Code
        Specifications for Merchant Presented QR Code Payments3 for anything not explicitly defined
        in this document.

3
    https://www.emvco.com/specifications/emv-qr-code-specification-for-payment-systems-emv-
qrcps-merchant-presented-mode/

Page | 8

Interoperable P2M Payments Using QR Code
                                                 EthSwitch QR Code Template (Table 2)

EMVCo
                 00              01                 02              04            06             26              28                52           53
  Tag ID
                                                                                               MAI4            MAI5
                                                   MAI1            MAI2          MAI3
  Desc.          PFI            POI                                                           Domestic       Domestic          MCC           Currency
                                                   Visa          Mastercard       UPI
                                                                                              Scheme 1       Scheme 2

EMVCo
                 54         55, 56 & 57                  58            59           60            62*          63             64               80
  Tag ID
                           Convenience              Country        Merchant      Merchant      Additional                 Alternate       Transaction
  Desc.     Amount                                                                                            CRC
                                     Fee             Code            Name          City        Data Field                 Language          Context
62* Additional Data Field is further broken down and explained below

EMVCo
                 81                  82               83                  84            85            86             87             88        89-99
  Tag ID
            Discounts           Offline
  Desc.     & Loyalty                to            e-comm.                     Scheme Specific                   Acquirer Specific             CRC
            Programs            Online

Additional Data Field Template (ID 62) (Table 3)

EMVCo Tag ID                                                                            62
                         01                02             03          04            05            06             07                08           09
                                                                                                                                               Addl.
   Description           Bill             Mobile         Store      Loyalty     Reference      Customer       Terminal
                                                                                                                              Purpose       Customer
                       Number         Number             Label      Number         Label         Label        Number
                                                                                                                                               Data

EMVCo Tag ID                                                                            62
                                10                    11             50             51             52-54              55-56                 57-99
   Description         Merchant Tax.               Merchant         Due        Amount after       Scheme            Acquirer             Reserved for
                                ID                 Channel          Date        Due Date          Specific          Specific             Future Use

Details of Data Objects within QR Standard

The details of all tags identified in the standard in the previous section are defined in Table 4 below:

EMVCo
                  Name                Format             Length      M/O/C          Description                       IPS Specific Notes
  Tag ID
            Payload
                                                                                 Default value is 01
    00      Format                          N              02             M
                                                                                 as per EMVCo.
            Indicator
            Point of
                                                                                 11- for Static QR
    01      Initiation                      N              02             O                                  Mandatory in RAAST P2M QR
                                                                                 12- for Dynamic QR
            Method
                                                                                                             MAI 28 will contain following in
            Merchant                                     var. up
  Refer                                                                          At least one MAI            Sub-tags:
            Account                        ANS            to 40           M
 Table 1                                                                         should be present               •        Sub Tag 00: GUID - A
            Information                                   each
                                                                                                                          [UUID] without the

Page | 9

Interoperable P2M Payments Using QR Code
                                                                                   hyphen (-) separators.
                                                                                   For example,
                                                                                   “581b314e257f41bfbb
                                                                                   dc6384daa31d16”
                                                                             •     Sub Tag 01: Creditor
                                                                                   Institution BIC which
                                                                                   is MSP (8 or 11)
                                                                             •     Sub Tag 02: Merchant
                                                                                   Account (24)
                                                                       Payer Bank will scan QR and
                                                                       use Creditor institution BIC and
                                                                       Merchant IBAN to create
                                                                       payment message (pacs.008).
                                               The category
          Merchant
                                               under which
   52     Category         N       04      M
                                               merchant falls (as
          Code
                                               per ISO 18245)
                                               Currency Code of
          Transaction
   53                      N       03      M   the transaction (as     ‘230’ for ETB
          Currency
                                               per ISO 4217)
                                               Amount of the
                                               transaction –           Payer Bank’s application should
                                 var. up
          Transaction                          either built into the   have the logic to prompt for
   54                     ANS     to 13    O
          Amount                               QR (dynamic) or         amount if amount is not
                                  each
                                               prompted from the       present.
                                               customer (static)
                                                                       TIP Indicator will only be
                                                                       applicable in specific merchant
                                                                       categories that should be
                                                                       allowed in IPS ET P2M Scheme
                                                                       Rules.

Merchant service providers will
                                                                       ensure this tag is only included
                                                                       if the category of Merchant is
          Tip or
                                                                       enabled for TIP. Merchant
   55     Convenience      N       02      O   If required.
                                                                       services provider (MSP) would
          fee Indicator
                                                                       determine if a particular
                                                                       merchant category is to be
                                                                       enabled for collection of TIPs.

The following values as per
                                                                       EMVCo standard will be used.
                                                                         •       01 – Prompt customer
                                                                                 for Adding Tip in
                                                                                 payment.

Page | 10

Interoperable P2M Payments Using QR Code
                                                                        •    02 – Fixed Tip Amount
                                                                             included in QR (Tag 56)
                                                                        •    03 – Percentage based
                                                                             TIP as per %age defined
                                                                             in Tag 57.
                                                                      e.g.
                                                                      01 = 1000 + [xxx]
                                                                      02 = 1000 + [100] = 1100
                                                                      03 = 1000 + 5% = 1050

Refer: Section 3.4 of EMV-
                                                                      Merchant-QR-Guidance-and-
                                                                      Examples-1.0 document
          Value of               var. up
   56     Convenience    ANS      to 13    C
                                               Any of these two is
          Fee (fixed)             each
                                               required if ID 55 is
          Value of               var. up
                                               populated.
   57     Convenience    ANS      to 05    C
          Fee (%)                 each
                                               Country code of
          Country                              the merchant.
   58                    ANS       02      M                          “ET” for Ethiopia
          Code                                 (Alpha-2 code - ISO
                                               3166)
                                               “Doing business as”
                                 var. up
          Merchant                             name of the
   59                    ANS      to 25    M
          Name                                 merchant as per
                                  each
                                               acquirer’s record.
                                               City of physical
                                                                      For online merchants, the CITY
                                               presence of
                                                                      should be registered head
                                               Merchant. If QR is
                                                                      office location of the
                                 var. up       generated through
          Merchant                                                    Merchant.
   60                    ANS      to 15    M   an online portal,
          City
                                  each         then the scheme
                                                                      List of Cities to be shared with
                                               shall decide how
                                                                      Participants which will be
                                               this field should be
                                                                      acceptable.
                                               populated.
                                               This includes
                                               information that
                                               may be explicitly
                                               defined in QR or
          Additional             var. up
                                               may be prompted
   62     Data Field       S      to 99    O
                                               to the customer.
          Template                each
                                               This is an optional
                                               field in EMVCo
                                               covering many
                                               sub- fields

Page | 11

Interoperable P2M Payments Using QR Code
                                               described in Table
                                               5 below.
                                               Cyclic Redundancy
   63     CRC            ANS       04      M   Check (as per
                                               EMVCo QRCPS)
                                               This allows the
                                               merchant’s name         Participant may opt to use this
                                               and city to be kept     to display Merchant Name in
          Merchant                             in an alternate /       Local Language(s)
                                 var. up
          Information                          local language. The     If Present, Payer application
   64                      S      to 99    O
          – Language                           scheme shall            will show the Merchant Name
                                  each
          Template                             decide how to           in Alternate language as well.
                                               populate this field     Refer to EMVCo Document
                                               in accordance with      Section 3.6 for example.
                                               EMV QRCPS.
                                                                       This field can be used by
                                                                       Merchant to convey Context
                                                                       of transaction. For example, if
                                                                       School Fee is being paid then
                                                                       Context can be a free text
                                                                       “School Fee for August 2022.”
                                               Context/Particulars
                                               of the Tx; may be
                                 var. up                               Merchant Service Provider /
          Context of                           prompted from the
   80                    ANS      to 50    O                           Payee who generates QR must
          Transaction                          customer or
                                  each                                 include either this field OR
                                               explicitly defined in
                                                                       Field 62/08 (Purpose of
                                               the QR.
                                                                       Transaction) in the QR.

Payer Institution will see if Tag
                                                                       80 or Tag 62/08 is present
                                                                       then display this on screen to
                                                                       customer.
                                               This field is
                                               reserved for
          Discounts &            var. up       Discounts &
                                                                       Isn’t needed right now but
   81     Loyalty        ANS      to 30    O   Loyalty programs
                                                                       good to have for future use.
          Programs                each         by the scheme or
                                               the acquirer /
                                               issuer.
                                               Reserved for
                                               Offline to Online
                                               Payments. O2O is
                                 var. up
          Offline to                           the experience          Isn’t needed right now but
   82                    ANS      to 50    O
          Online                               where the               good to have for future use.
                                  each
                                               customer scans a
                                               QR code at the
                                               merchant location

Page | 12

Interoperable P2M Payments Using QR Code
                                                    which contains a
                                                    URL and
                                                    subsequently
                                                    routes the
                                                    customer to the
                                                    merchants.
                                                    website/portal.
                                  var. up           Reserved for e-
           E-                                                               Isn’t needed right now but
   83                     ANS      to 40     O      Commerce related
           Commerce                                                         good to have for future use.
                                   each             transactions.
                                                                            Tag 84 will contain End-End ID
                                                                            of 35 characters in case of
                                                                            Dynamic QR generated by
                                                                            Payee/Merchant service
                                                                            Provider, with Request to Pay
                                                                            (RTP).

Acquirer will generate Dynamic
                                                                            QR with Tag84 containing
                                                                            same E2E ID which is sent in
                                  var. up           To be used by the
           Scheme                                                           RTP - this is special RTP which
 84-86                    ANS      to 40     O      domestic scheme
           Specific                                                         will not go to Payer FI - It will
                                   each             for its participants.
                                                                            be like RTP now.

The Field will be scanned by
                                                                            Payer and passed on in the
                                                                            PACS.008 message so it can be
                                                                            matched with Request to Pay
                                                                            (PAIN.013) message.

Tag 85 will contain valid value
                                                                            of TTC
                                                    To be used by the
                                  var. up
           Acquirer                                 acquirer / issuer for
 87-88                    ANS      to 40     O
           Specific                                 onward usage of
                                   each
                                                    its own customers.
                                  var. up
           Reserved for                             Reserved for
 89-99                    ANS      to 40     O
           Future Use                               future use.
                                   each

Key Assumptions:
   •     IDs from 80-99 are unreserved under EMVCo, a few of which have been customized under
         this standard to be used within the country.
   •     The acquirers, while generating QR Code, will ensure that the overall length of the payload
         should not exceed 512 characters as per EMVCo. specification.

Page | 13

Interoperable P2M Payments Using QR Code
   •      Whereas ID 82 has been reserved for Offline-to-Online transactions (O2O) and already
          described in table 2 above; extra care should be taken in terms of its security considerations.
          It shall be the responsibility of the acquirer to ensure that the URL being mapped in this field
          pertains to the legitimate and secure website/portal of the merchant. The acquirer shall also
          undertake necessary measures on ongoing basis related to information security of the user
          for this purpose, including but not limited to; periodic checks of the URL for authenticity and
          ensuring that no sensitive information (any identity disclosing information, any password,
          OTP, or any other financial information) is asked from user on that URL at any given point of
          time. Since this is an optional field, the issuers may develop their apps/portals to prohibit
          reading / processing of this field for off-us transactions OR allow it only for on-us transactions
          (where the QR provider and app/portal provider is the same entity).

(Below) Table 5: Details of Data Objects for Additional Data Field Template under ID 62

EMVCo
                Name         Format    Length    M/O/C       Description              IPS Specific Notes
 Tag ID
                                                                                 Will be present as Mandatory
                                                                                 for specific Merchant
                                                                                 Category codes and
                                                                                 Transaction Codes where
                                                                                 Payment is made against
                                                                                 specific Order.

•   Utility Bills (consumer
                                                                                     number)
                                                         Bill/Invoice/Vouche     •   P2G payments (Invoice
                                                         r number. E.g.,             or Bill Number as issued
                                       var. up           Utility bills, school       by Govt. Agency Biller)
   01       Bill Number        ANS                 O
                                        to 25            fee vouchers,           •   Any Other bills (Bill
                                                         challan vouchers            Number/Voucher
                                                         etc.                        number)

Usage in case of Customer
                                                                                 initiated Payment.
                                                                                 The QR will have bill specific
                                                                                 Information and Payer will
                                                                                 scan and pass this
                                                                                 information in PACS.008 to
                                                                                 Payee for them to validate
                                                                                 before accepting Payment.
                                       var. up                                   Can be used for Mobile top-
                                                         Mobile number of
   02       Mobile Number      ANS      to 25      O                             up. Payee will put “***” if
                                                         the merchant.
                                                                                 they need Mobile Number of

Page | 14

Interoperable P2M Payments Using QR Code
                                                                       transaction processing. (e.g.,
                                                                       Mobile top-up)

Payer will send Mobile
                                                                       Number in Payment message
                                                                       in (PACS.008) in appropriate
                                                                       field as per Message
                                                                       Specifications.
                                   var. up                             For Proximity Payments, this
                                                 The branch name
   03     Store Label      ANS      to 25    O                         field will contain the Branch
                                                 of the merchant.
                                                                       Name of Merchant
                                   var. up                             If the Payee has a Loyalty
                                    to 25                              program and wants
                                                                       customers to input their
                                                                       Loyalty Card Number during
                                                                       payment, then the QR will
                                                                       contain this field with “***”
                                                 The identifier
                                                                       Management of Loyalty
                                                 assigned to a
                                                                       program(s) will be the
          Loyalty                                customer by a
   04                      ANS               O                         responsibility of MSP/Payee
          Number                                 merchant/brand/bu
                                                                       institution.
                                                 siness for loyalty
                                                                       Payer application will prompt
                                                 rewards.
                                                                       customer to Enter their
                                                                       Loyalty Card Number while
                                                                       making payments so they
                                                                       can earn loyalty points.
                                                                       See EMVCo document
                                                                       Section 3.5.1 for example.
                                   var. up                             For merchants using
                                    to 25                              electronic systems for
                                                                       managing Sales, this field will
                                                 A label or
                                                                       be mandatory and will
                                                 reference number
          Reference                                                    contain Merchant provided
   05                      ANS               O   that needs to be
          Label                                                        additional information which
                                                 attached to a QRC
                                                                       they need to reconcile
                                                 or Transaction.
                                                                       Payment against and order.
                                                                       See EMVCo Document
                                                                       Section 3.5 for examples
                                                 The consumer
                                                 number issued by
                                                 the merchant to       This field will be present in
          Customer                 var. up       uniquely identify a   specific Category codes
   06                      ANS               O
          Label                     to 25        customer. For eg      where Customer is enrolled
                                                 subscriber id,        by Merchant/Biller.
                                                 student enrollment
                                                 no. etc.

Page | 15

Interoperable P2M Payments Using QR Code
                                   var. up                               For Proximity Payments
                                    to 25        The counter ID or       where Person is paying a
   07     Terminal Label   ANS               O   Till ID where the       merchant in person, the QR
                                                 QRC is placed.          code will contain Terminal ID
                                                                         information.
                                   var. up                               Purpose will be List of values
                                    to 25        The purpose of          that will be provided by
                                                 transaction. May        EthSwitch, and it is
          Purpose of                             be prompted from        Mandatory that Tag 62/08
   08                      ANS               O
          Transaction                            the customer or         will always be present – Tag
                                                 explicitly defined in   80 may or may not be
                                                 the QR.                 present. Example of Purpose
                                                                         can be “Fee Payment”
                                                                         The field will contain the
                                                                         characters:
                                                                             •    A = Address
                                                                                  Request
                                                                             •    M = Mobile Number
                                                                             •    E = Email
                                                                         The QR can contain either all
                                                 This includes
                                                                         characters or only specific
                                                 additional data
                                                                         characters.
                                                 request (Address,
          Additional                             Mobile number,
                                   var. up                               The payer app will prompt
   09     Customer         ANS               O   email address)
                                    to 25                                customers to enter the
          Data Request                           from the consumer
                                                                         information or show the
                                                 which may be
                                                                         default information already
                                                 prompted from the
                                                                         registered with payer to be
                                                 user.
                                                                         shared with MSP/Payee
                                                                         against this request.
                                                                         Payer FI will send the
                                                                         information in Payment
                                                                         Message (PACS.008) in
                                                                         appropriate field as per
                                                                         specifications.
                                                 The identification      Will be kept optional.
                                                 number assigned         Merchants who are
          Merchant Tax             var. up       to the merchant by      registered with the tax
   10                      ANS               O
          ID                        to 25        federal or              authority so that they can
                                                 provincial tax          put their Tax Identification
                                                 authority.              Number in this tag.
                                                 The characteristics
                                                 of the channel
          Merchant
   11                      ANS       03      O   used for a
          Channel
                                                 particular
                                                 transaction. Refer

Page | 16

Interoperable P2M Payments Using QR Code
                                                 to EMV QRCPS for
                                                 details
           Reserved for
 12 – 49   Future Usage      S        -      O
           for EMVCo
                                                                         For Payments which have a
                                                                         Due Date, this will be
                                                                         present.

If the QR is not generated
                                                                         dynamically, the Payer must
                                                 The due date of
                                                                         ensure that Amount
                                                 payment in the
                                                                         prompted to customer is
                                                 format
                                                                         accurate based on Due Date.
   50      Due Date          N       08      O   DDMMYYYY. This
                                                                         The Payee will also validate
                                                 may be used for
                                                                         the same when receiving
                                                 Bill/Voucher
                                                                         PACS.008
                                                 payments.
                                                                         In case of Dynamic QR
                                                                         generated as Request to Pay,
                                                                         the QR code should contain
                                                                         appropriate TransacKon
                                                                         Amount payable for the bill.
                                                 The amount to be
                                                 paid after Due date
           Amount After            var. up       has passed. This        Present if Due Date is
   51                        N               C
           Due Date                 to 13        shall be present if     present in Tag 50.
                                                 “Due Date” Field is
                                                 populated.
                                                 To be used by the
           Scheme                  var. up
 52 – 54                     S               O   domestic scheme
           Specific                 to 25
                                                 for its participants.
                                                 To be used by the
           Acquirer                var. up       acquirer / issuer for
 55 – 56                     S               O
           Specific                 to 25        usage of its own
                                                 customers.
           Reserve for
                                   var. up
 57 – 99   Future Usage      S               O
                                    to 25
           EthSwitch/NBE

Page | 17

Interoperable P2M Payments Using QR Code

5. QR Code Interoperability for In-Store Purchases

One of the objectives of this standard is to harmonize the practices of QR Code placement at
merchant locations. While devising a country-wide standard for QR codes, the possible scenarios in
terms of QR generation and placement may be kept in mind at the time of merchant onboarding. The
idea is to introduce interoperability of QR codes at the merchant level using multi-scheme QR
template as described earlier. The following table exhibits these scenarios as well as the desired
action of the acquirer at the time of merchant onboarding:

Q1. Will the      Will the existing
     QR                                    acquirer place a   QR be replaced by    # of QRs at
  Placement            Description           new QR at            a new and        Merchant
   Scenario                                   merchant            backward          Location
                                              location?        compatible QR?
               A merchant is being
               onboarded by the
 Scenario 1                                      Yes                 N/A            One QR
               acquirer for the first
               time.
               A merchant, already
               onboarded by an
               acquirer on an                                 Yes, the new QR
               international scheme,                            code will be
 Scenario 2                                      Yes                                One QR
               is being onboarded by                          interoperable for
               the same acquirer on                            both schemes.
               another international
               scheme.
               A merchant, already
               onboarded by an                                Yes, the new QR
               acquirer on                                         will be
               international                                  interoperable for
 Scenario 3                                      Yes                                One QR
               scheme(s) is being                                all previous
               onboarded by the                               schemes as well
               same acquirer on a                               as new one.
               domestic scheme.
               A merchant onboarded
               by an acquirer on an
                                                              There will be two
               international or
                                                              QRs at merchant
 Scenario 4    domestic scheme is                Yes                               Two QRs
                                                               location in this
               being onboarded by a
                                                                  scenario.
               different acquirer on
               an international or

Page | 18

Interoperable P2M Payments Using QR Code
               domestic (or both or
               multiple of
               them)

6. Roles and Responsibilities

The broad roles and responsibilities of respective participants are as follows:

Acquirers

1.   For all the acquirers currently working or intending to undergo QR offerings, it will be
        mandatory to be on-boarded with IPS ET as a domestic payment scheme, in due course as
        per the plan shared by the EthSwitch team. However, they may also work with international
        payment schemes and other domestic schemes as per their choice and feasibility.
   2. The acquirers will start to generate QR codes for newly onboarded merchants and replace
        existing QR Codes in compliance with this standard.
   3. For the situation depicted in scenario 2 and 3 in section above, where an acquirer has
        onboarded or is onboarding the same merchant to an additional scheme; the acquirer will
        replace the QRC(s) at merchant locations with a unified and interoperable QR code using
        multi-scheme template under this standard.
   4. The QR acquirers are encouraged to generate dynamic QRs through online portals /apps (for
        e- Commerce) or digital display screens (for in-store purchases).
   5. All acquirers shall offer QR codes to the merchants under IPS ET, in addition to other domestic
        and international schemes. The acquirers working in the closed-loop model shall cease to
        issue closed-loop QR and only scheme-based (open-loop) QR codes will be operational.
   6. The acquirers may use the data objects, reserved as Acquirer Specific, for their own
        customers i.e., where the acquirer and issuer are the same entity.

Issuers

1.   The issuers of QRCs shall develop their apps and portals to be aligned with the specifications
        mentioned in this document, enabled to read all QRCs that have been generated
