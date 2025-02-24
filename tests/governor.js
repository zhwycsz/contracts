const { expect } = require('chai');
const { ethers, deployments } = require('hardhat');
const keccak256 = require('keccak256');
const { testArgs } = require('../utils/configs');
const { setupProof, contractsReady } = require('../utils/helpers');
const _args = testArgs();
const _governorSettings = {
  membership: _args[2].membership.governor,
  share: _args[2].share.governor,
};

const _Votes = {
  Against: 0,
  For: 1,
  Abstain: 2,
};

describe('Governor', function () {
  before(async function () {
    await setupProof(this);
  });

  beforeEach(async function () {
    await contractsReady(this, true)();
    await deployments.fixture(['Mocks']);

    this.voters = this.whitelistAccounts;
    this.votersAddresses = this.whitelistAddresses;
    this.receiver = await ethers.getContract('CallReceiverMock');

    // Proposal for testing
    this.proposal = [
      // targets
      [this.receiver.address],
      // value (of ETH)
      [0],
      // calldata
      [this.receiver.interface.encodeFunctionData('mockFunction()', [])],
      // description
      '<proposal description>',
    ];

    this.shortProposal = [
      this.proposal[0],
      this.proposal[1],
      this.proposal[2],
      keccak256(this.proposal.slice(-1).find(Boolean)),
    ];

    this.proposalId = await this.governor.hashProposal(...this.shortProposal);
  });

  it('deployment check', async function () {
    // Make sure membership governor works properly
    expect(await this.governor.name()).to.be.equal(_args[0].name + '-MembershipGovernor');
    expect(await this.governor.token()).to.be.equal(this.membership.address);
    expect(await this.governor.votingDelay()).to.be.equal(_governorSettings.membership.votingDelay);
    expect(await this.governor.votingPeriod()).to.be.equal(
      _governorSettings.membership.votingPeriod
    );
    expect(await this.governor.proposalThreshold()).to.be.equal(
      _governorSettings.membership.proposalThreshold
    );
    expect(await this.governor.quorum(0)).to.be.equal(0);
    expect(await this.governor.timelock()).to.be.equal(this.treasury.address);

    // Make sure share governor works properly
    expect(await this.shareGovernor.name()).to.be.equal(_args[0].name + '-ShareGovernor');
    expect(await this.shareGovernor.token()).to.be.equal(await this.membership.shareToken());
    expect(await this.shareGovernor.votingDelay()).to.be.equal(_governorSettings.share.votingDelay);
    expect(await this.shareGovernor.votingPeriod()).to.be.equal(
      _governorSettings.share.votingPeriod
    );
    expect(await this.shareGovernor.proposalThreshold()).to.be.equal(
      _governorSettings.share.proposalThreshold
    );
    expect(await this.shareGovernor.quorum(0)).to.be.equal(0);
    expect(await this.shareGovernor.timelock()).to.be.equal(this.treasury.address);

    // Can use `this.voters.forEach` to expect test cases
    this.voters.forEach(async (adr, idx) => {
      expect(await this.membership.balanceOf(this.votersAddresses[idx])).to.be.equal(1);
      expect(await this.membership.getVotes(this.votersAddresses[idx])).to.be.equal(1);
    });
  });

  describe('#propose', function () {
    it('Should able to make a valid propose', async function () {
      await expect(
        this.governor
          .connect(this.owner)
          .functions['propose(address[],uint256[],bytes[],string)'](...this.proposal)
      ).to.emit(this.governor, 'ProposalCreated');
    });

    // this.accounts[5] is not a voter
    it('Should not able to make a valid propose if user do not hold a NFT membership', async function () {
      await expect(
        this.governor
          .connect(await ethers.getSigner(this.accounts[5]))
          .functions['propose(address[],uint256[],bytes[],string)'](...this.proposal)
      ).to.be.revertedWith('GovernorCompatibilityBravo: proposer votes below proposal threshold');
    });
  });

  describe('#vote', function () {
    it('Should able to cast votes on a valid proposal', async function () {
      await expect(
        this.governor
          .connect(this.owner)
          .functions['propose(address[],uint256[],bytes[],string)'](...this.proposal)
      ).to.emit(this.governor, 'ProposalCreated');
      // this.deadline = await this.governor.proposalDeadline(this.proposalId);
      // this.snapshot = await this.governor.proposalSnapshot(this.proposalId);

      // await time.advanceBlockTo(this.snapshot + 1);

      // First vote, check event `VoteCast`
      await expect(this.governor.connect(this.voters[1]).castVote(this.proposalId, _Votes.For))
        .to.emit(this.governor, 'VoteCast')
        .withArgs(this.votersAddresses[1], this.proposalId, _Votes.For, 1, '');

      // Check `hasVoted` func
      expect(
        await this.governor
          .connect(this.voters[1])
          .hasVoted(this.proposalId, this.votersAddresses[1])
      ).to.be.equal(true);

      // Another vote, check event `VoteCast`
      await expect(
        this.governor
          .connect(this.voters[2])
          .castVoteWithReason(this.proposalId, _Votes.For, "I don't like this proposal")
      )
        .to.emit(this.governor, 'VoteCast')
        .withArgs(
          this.votersAddresses[2],
          this.proposalId,
          _Votes.For,
          1,
          "I don't like this proposal"
        );

      // fastforward
      // await time.advanceBlockTo(this.deadline + 1);

      // Add proposal to queue
      await expect(
        this.governor.functions['queue(address[],uint256[],bytes[],bytes32)'](...this.shortProposal)
      ).to.emit(this.governor, 'ProposalQueued');

      // await time.increase(3600);

      // Excute
      // excutor can be any address but function is triggered by `timelock` as `msg.sender`
      await expect(
        this.governor.functions['execute(address[],uint256[],bytes[],bytes32)'](
          ...this.shortProposal
        )
      )
        .to.emit(this.governor, 'ProposalExecuted')
        .to.emit(this.treasury, 'CallExecuted')
        .to.emit(this.receiver, 'MockFunctionCalled');
    });

    // this.accounts[5] is not a voter
    it('Should not able to cast vote if user do not hold a NFT membership', async function () {
      await expect(
        this.governor
          .connect(this.owner)
          .functions['propose(address[],uint256[],bytes[],string)'](...this.proposal)
      ).to.emit(this.governor, 'ProposalCreated');

      await expect(
        this.governor
          .connect(await ethers.getSigner(this.accounts[5]))
          .castVote(this.proposalId, _Votes.For)
      ).to.be.revertedWith('VotesBelowProposalThreshold()');
    });
  });
});
